// ignore
//@name:[禁] 蝴蝶·BestJavPorn
//@version:2
//@webSite:https://bestjavporn.me
//@remark:7 分类 · 列表 → 详情页 rocketlazyload → /xx/ 嵌入页 pox+dp；播放时实时 AES-256-CBC 解密直出 m3u8（详情不落 token，防过期）；v2 让请求失败的原因直接显示出来（网络阻断 / Cloudflare 人机验证 / HTTP 状态码）
//@type:100
//@instance:bestjav2026
//@isAV:1
//@order: F
import {} from '../../core/uzVideo.js'
import {} from '../../core/uzHome.js'
import {} from '../../core/uz3lib.js'
import {} from '../../core/uzUtils.js'
// ignore

// ============================================================================
// 蝴蝶·BestJavPorn —— 移植自 bestjav.py（站点：bestjavporn.me）
//
// 原版的整条链路：
//   列表页(/category/xxx/ 或 /?filter=xxx)  →  <article class="loop-video">
//   详情页  →  <script data-rocketlazyloadscript='data:text/javascript;base64,...'>
//              解 base64 取 defaultUrl  →  /xx/xxxxxxxx
//   /xx/ 嵌入页  →  let pox = '...'  let dp = '...'
//              用 CryptoJS 那套 EVP_BytesToKey(MD5) 推 key，AES-256-CBC 解出
//              api.videplay.us/data/master.m3u8/<token>
//   master.m3u8  →  挑 BANDWIDTH 最大的 variant
//
// 保留原版的部分（逻辑一字未改）：
//   · siteUrl / UA（Android Mobile Chrome 120）/ 品牌与 TG 群文案
//   · homeContent 的 7 个分类、顺序与 type_id
//   · categoryContent 的 route 路由表、分页规则（`/page/N/` 与 `&paged=N` 二选一）
//   · 列表解析：`<article ... loop-video ...>` 优先，`thumb-block` 切分兜底
//   · duration 落点、title 兜底（`<header>…<span>`）、`javascript:` 过滤
//   · has_next 判定（`/page/N+1` 或 `paged=N+1`）与 total=9999 的语义
//   · _extract_embed_url：base64 载荷 → defaultUrl，兜底 `/xx/` 正则，并统一升级到 https
//   · _resolve_stream 的顺序：页面直含 m3u8（排除 preview）→ 嵌入页 pox/dp 解密 → 嵌入页裸 m3u8
//   · cryptojs_aes_decrypt：EVP_BytesToKey(MD5 迭代，32+16) + AES-256-CBC + 手工剥 PKCS7
//     口令取自 pox：按 '+' 切分取第 2 段再去掉首字符；IV 用报文里的 iv（不是 KDF 出来的那个）
//   · _prefer_media_playlist：master.m3u8 里取 BANDWIDTH 最大者（比较用 >=，与原版一致）
//   · detailContent 刻意「不在详情解密」，只记 raw_page@@<详情页URL>，等真正播放时再解（防 token 过期）
//   · playerContent 的播放头：User-Agent / Referer / Origin 全部指向站点根
//   · searchContent 走 `/?s=` 与 `/page/N/?s=`，复用列表解析
//   · _fetch 的「最多试 2 次」
//
// 与原版不同之处 —— 只有下面这些，每条都是为了「在 uz 上能跑对」或「修掉实测可证的错」：
//   A1  uz 没有 TVBox 的 parse=1 语义。解密失败时，原版会把 `raw_page@@...` 原样丢给播放器
//       （那是内部标识，不是 URL，播放器必然打不开）。这里改为填 backData.error。
//   A2  详情页封面：原版用 _extract_img(详情页HTML)，取的是全文第一个 data-src。
//       实测详情页第一个 <img> 永远属于底部「Related videos」，所以原版封面永远是错的。
//       改为优先 og:image（= twitter:image = 播放器背景图），再退 itemprop="thumbnailUrl"，
//       最后才退回原逻辑。
//   A3  详情页时长：原版正则 `class="duration"` 在详情页命中的同样是「相关视频」的时长
//       （实测 /mond-309 得到 03:59:00，本片其实是 01:52:00）。改为读本片自己的
//       `<meta itemprop="duration" content="P0DT1H52M0S">`，退 `#video-date` 里的
//       `Duration: 01:52:00`，都没有才算未知（只影响介绍文案，不影响播放）。
//   A4  空结果 / 越界页：原版把「Nothing found」页和「Page not found」页当普通列表页解析。
//       实测这两页各自都带 20 条「Random videos」——于是搜索无结果会返回 20 条完全不相干
//       的视频；翻过最后一页之后还会一直有内容，永远翻不完。这里识别出来返回空列表。
//       （关掉：把 kGuardEmptyPage 改成 false。）
//   A5  去掉 _wrap_img 的 `@Referer=…@User-Agent=…` 后缀。那是 TVBox 的私有语法，
//       uz 会当成 URL 的一部分 → 图必 404。实测该图床 http/https 直连都 200、且不校验
//       Referer，所以本来也不需要这个后缀。
//   A6  uz 的 VideoDetail 没有 `style` 字段，列表项不再带 `style:{type:'rect',ratio:1.78}`；
//       同样 uz 的 RepVideoList 也没有 pagecount/limit，只回填 data 与 total。
//   A7  标题里的 HTML 实体（`&#8217;` `&amp;` 等）做解码。站点把实体写死在 title 属性里，
//       原版 _clean_text 只去标签不还原实体，实测列表里到处都是 `neighbor&#8217;s wife`
//       这种字面量。解码只是让标题变回人话，不改变任何匹配逻辑。
//   A8  vod_content 不再做 `& → &amp;` 的 HTML 转义：uz 是纯文本展示，转义后会看到字面量
//       `&amp;`。文案模板本身与原版逐字一致。
//   A9  站点地址允许被 App 里配置的 @webSite 覆盖（换镜像域名不用改代码），原版是写死的。
//       只在 getClassList 里接受覆盖，避免详情/播放时把影片 URL 误当成站点根。
//   A10 buildListUrl 里 tid 是 `?s=xxx` 这种「只有查询串」时补一个 `/`。原版会拼出
//       `https://站点?s=xxx`（少了路径分隔符）。原版的 searchContent 永远带前导 `/`，
//       所以这条分支在原版里从来走不到，属于潜藏缺陷，这里顺手补正。
//
// ----------------------------------------------------------------------------
// v2 新增（真机反馈「只显示标签页、视频数据没有获取到」后做的加固）
//
// 症状成因：getClassList 是纯本地拼的 7 个分类，不发请求，所以标签页一定显示得出来；
// 而 getVideoList 要真的去请求站点。一旦请求失败，v1 会把失败**静默**吞成空列表 ——
// 用户看到的就是「标签页在、列表空」，且没有任何原因提示。
//
//   B1  把失败原因带出来：req 的 HTTP 状态码 / 错误消息 / 是否 Cloudflare 挑战页，
//       统统翻译成人话填进 backData.error，App 会直接显示。列表为空和网络失败从此可区分。
//   B2  识别 Cloudflare 挑战页（`Just a moment...` / `cf_chl_` / `Attention Required`），
//       给单独文案。站点挂在 Cloudflare 后面（bestjavporn.com 实测 403 + 挑战页）。
//   B3  显式传超时（sendTimeout/receiveTimeout = 10000）。真机 req 的默认是 30 秒，
//       再叠加原版「试 2 次」= 用户要干等 60 秒。10000 在毫秒读法下是 10 秒（贴合原 py
//       的 timeout=10）；万一原生是按「秒」读，那就等于不超时 —— 而默认值 30000 在那个
//       读法下同样是不超时，所以两种解释都不会比现状更差。（本机 core 实现是把值直接交给
//       setTimeout，即毫秒；全库唯一的官方用法 receiveTimeout: 40 更像秒。单位确实不定。）
//   B4  第 2 次尝试改用「更像浏览器」的请求特征（补齐 Accept / Sec-Fetch-* / 不强制 HTTP2）。
//       依据是实测：同一个 URL 换请求特征会得到**不同**结果（301 / 403+挑战 都出现过），
//       所以这是有依据的兜底尝试，不是保证有效。为此把 403 也纳入重试 —— v1 遇到 403 直接
//       返回，等于把这条兜底路径自己关掉了。成功路径的逻辑与正文解析一律没动。
//   B5  详情页请求失败时不再返回「空壳详情」（v1 会给出标题=正片详情、封面空、点播放必失败）。
// ----------------------------------------------------------------------------

/**
 * 站点地址（原 py 的 self.siteUrl）。仅允许在 getClassList 里被 @webSite 覆盖，见 A9。
 */
let gSite = 'https://bestjavporn.me'

const kUa =
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const kTgGroup = 'https://t.me/tvshare23'
const kBrand = '蝴蝶影视'
const kBrandActor = '🦋 TG群: @tvshare23'
const kBrandDirector = '🦋 蝴蝶影视'
const kPlayFrom = '蝴蝶专线'
const kEpisodeName = '超清正片'

/** 原 py homeContent 的 7 个分类，顺序与 type_id 原样 */
const kClasses = [
    { id: 'censored', name: '有码专区' },
    { id: 'amateur', name: '素人专区' },
    { id: 'reducing-mosaic', name: '去码专区' },
    { id: 'latest', name: '最新更新' },
    { id: 'most-viewed', name: '最多观看' },
    { id: 'longest', name: '最长时长' },
    { id: 'random', name: '随机推荐' },
]

/** 原 py categoryContent 的 route 表，逐条照抄 */
const kRoute = {
    censored: '/category/censored/',
    amateur: '/category/amateur/',
    'reducing-mosaic': '/category/reducing-mosaic/',
    latest: '/?filter=latest',
    'most-viewed': '/?filter=most-viewed',
    longest: '/?filter=longest',
    random: '/?filter=random',
}

/** A4 的开关 */
const kGuardEmptyPage = true

/**
 * B3：单次请求的超时（毫秒）。真机 req 的默认是 30000，原版又要试 2 次，
 * 站点不通时用户要干等 60 秒才看到「空列表」。这里压到 10 秒。
 * 取值理由见文件头 B3：这个数在毫秒/秒两种读法下都不会比现状更差。
 */
const kTimeoutMs = 10000

/** Cloudflare 挑战页的体量上限：真站正常页面 58–85KB，挑战页约 5.7KB（2026-09 实测） */
const kChallengeMaxLen = 30000

// ============================================================================
// 工具函数
// ============================================================================

/** 原 py _clean_text：去标签 + 空白折叠（A7 额外做实体解码） */
function cleanText(raw) {
    const t = String(raw == null ? '' : raw).replace(/<[^>]+>/g, '')
    return htmlDecode(t)
        .replace(/[\r\n\t\s]+/g, ' ')
        .trim()
}

/**
 * A7：还原 HTML 实体。站点把 `&#8217;` 这类实体直接写在 title 属性里，
 * 只做解释，不做任何反向操作。
 */
function htmlDecode(s) {
    if (!s || s.indexOf('&') === -1) return s
    return String(s)
        .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (m, d) => safeCodePoint(parseInt(d, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&ndash;/g, '–')
        .replace(/&mdash;/g, '—')
        .replace(/&hellip;/g, '…')
        .replace(/&lsquo;/g, '‘')
        .replace(/&rsquo;/g, '’')
        .replace(/&ldquo;/g, '“')
        .replace(/&rdquo;/g, '”')
        .replace(/&middot;/g, '·')
        .replace(/&amp;/g, '&')
}
function safeCodePoint(code) {
    try {
        if (!isFinite(code) || code < 0 || code > 0x10ffff) return ''
        return String.fromCodePoint(code)
    } catch (e) {
        return ''
    }
}

/** 原 py format_remarks */
function formatRemarks(brand, meta) {
    const cleanMeta = String(meta == null ? '' : meta)
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
    if (cleanMeta) return brand + ' | ' + cleanMeta
    return brand
}

/** 等价于 Python urllib.parse.quote(s)（默认 safe='/'）——原 py 的 quote(str(key).strip()) */
function pyQuote(s) {
    return encodeURIComponent(String(s == null ? '' : s))
        .replace(/%2F/gi, '/')
        .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** 等价于原 py 的 urljoin(self.siteUrl, href) 在本站场景下的行为 */
function absUrl(href) {
    const h = String(href == null ? '' : href).trim()
    if (!h) return ''
    if (h.indexOf('http') === 0) return h
    if (h.indexOf('//') === 0) return 'https:' + h
    if (h.charAt(0) === '/') return gSite + h
    return gSite + '/' + h
}

/** 把 `http://` 升级成 `https://`（原 py 在多处做同样处理） */
function toHttps(u) {
    const s = String(u == null ? '' : u)
    if (s.indexOf('http://') === 0) return 'https://' + s.slice(7)
    return s
}

function toInt(v, dft) {
    const n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10)
    return isFinite(n) ? n : dft
}

/** 用真机同款 CryptoJS 解 base64（只用于 ASCII/UTF-8 文本） */
function decodeBase64Utf8(b64) {
    return Crypto.enc.Utf8.stringify(Crypto.enc.Base64.parse(b64))
}

/** 剥 PKCS7 填充：原 py 是 `if 1 <= pad <= 16: out = out[:-pad]`，这里逐字对齐 */
function stripPkcs7(text) {
    const s = String(text == null ? '' : text)
    if (!s) return ''
    let end = s.length
    const pad = s.charCodeAt(end - 1)
    if (pad >= 1 && pad <= 16 && pad <= end) end -= pad
    return s.slice(0, end)
}

/**
 * 原 py cryptojs_aes_decrypt 的等价实现 —— 也就是浏览器里
 * `CryptoJS.AES.encrypt(明文, 口令)` 的逆运算。
 *
 *   · 密钥：EVP_BytesToKey（MD5(上一轮摘要 + 口令 + salt) 反复迭代），取前 32 字节 → AES-256
 *   · 向量：用报文里的 iv（原 py 把 KDF 出来的 iv 丢掉了，别改）
 *   · 模式：AES-256-CBC + NoPadding，PKCS7 自己剥（对齐原 py 的手工处理）
 *   · 口令：pox 按 '+' 切分后取第 2 段，再去掉首字符
 */
function bestjavAesDecrypt(pox, dpB64) {
    try {
        const dataJson = decodeBase64Utf8(dpB64)
        const d = JSON.parse(dataJson)
        // 原 py 有 `.replace("\\/", "/")`；JS 里 JSON.parse 已经还原过 `\/`，这里是幂等的兜底
        const ct = String(d.ct).replace(/\\\//g, '/')
        const iv = Crypto.enc.Hex.parse(d.iv)
        const salt = Crypto.enc.Hex.parse(d.s)

        const parts = String(pox).split('+')
        if (parts.length < 2) return ''
        const keyStr = parts[1].length > 1 ? parts[1].slice(1) : parts[1]

        const pw = Crypto.enc.Utf8.parse(keyStr)
        let dtot = Crypto.lib.WordArray.create()
        let dgst = Crypto.lib.WordArray.create()
        // 原 py 的循环条件是 len(dtot) < key_len + iv_len（32+16=48 字节）
        while (dtot.sigBytes < 48) {
            dgst = Crypto.MD5(dgst.clone().concat(pw).concat(salt))
            dtot = dtot.clone().concat(dgst)
        }
        const key = Crypto.enc.Hex.parse(Crypto.enc.Hex.stringify(dtot).slice(0, 64))

        const dec = Crypto.AES.decrypt(ct, key, {
            iv: iv,
            mode: Crypto.mode.CBC,
            padding: Crypto.pad.NoPadding,
        })
        let out = ''
        try {
            out = Crypto.enc.Utf8.stringify(dec)
        } catch (e) {
            return ''
        }
        return stripPkcs7(out)
            .trim()
            .replace(/^"|"$/g, '')
            .replace(/\\\//g, '/')
    } catch (e) {
        return ''
    }
}

/** `P0DT1H52M0S` → `01:52:00`（只用于介绍文案） */
function isoDurationToClock(iso) {
    const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)
    if (!m) return ''
    const d = parseInt(m[1] || '0', 10)
    const h = parseInt(m[2] || '0', 10) + d * 24
    const mi = parseInt(m[3] || '0', 10)
    const se = parseInt(m[4] || '0', 10)
    if (!h && !mi && !se) return ''
    const pad = (n) => (n < 10 ? '0' + n : String(n))
    return pad(h) + ':' + pad(mi) + ':' + pad(se)
}

// ============================================================================
// 扩展主体
// ============================================================================

class bestjavClass extends WebApiBase {
    constructor() {
        super()
        this.kUa = kUa
        // 原 py _fetch 的默认头（Accept-Encoding 与 Connection 交给 App 自己的网络栈，
        // 不照抄 —— 手写 Accept-Encoding 可能让原生请求返回未解压的裸字节）
        this.kHeaders = {
            'User-Agent': kUa,
            Accept: '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }
        // B4：第 2 次尝试用的「更像浏览器」的头（首轮失败后才会用到，成功路径不受影响）
        this.kBrowserHeaders = {
            'User-Agent': kUa,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
        }
    }

    //MARK: - 分类

    /**
     * 获取一级分类
     * @param {UZArgs} args
     * @returns {Promise<JSON.stringify(new RepVideoClassList())>}
     */
    async getClassList(args) {
        const backData = new RepVideoClassList()
        try {
            // A9：只在分类这一步接受 App 里配置的站点地址覆盖
            const u = String((args && args.url) || '').trim()
            if (u.indexOf('http') === 0) gSite = u.replace(/\/+$/, '')

            const list = []
            for (let i = 0; i < kClasses.length; i++) {
                const videoClass = new VideoClass()
                videoClass.type_id = kClasses[i].id
                videoClass.type_name = kClasses[i].name
                // 本站没有二级分类，也没有筛选面板
                videoClass.hasSubclass = false
                list.push(videoClass)
            }
            backData.data = list
        } catch (error) {
            backData.error = '获取分类失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    /**
     * 本站没有二级分类，按契约留一个空实现
     * @param {UZArgs} args
     * @returns {Promise<JSON.stringify(new RepVideoSubclassList())>}
     */
    async getSubclassList(args) {
        const backData = new RepVideoSubclassList()
        try {
            const sub = new VideoSubclass()
            sub.class = []
            sub.filter = []
            backData.data = sub
        } catch (error) {
            backData.error = '获取二级分类失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 列表

    /**
     * 获取分类视频列表
     * @param {UZArgs} args
     * @returns {Promise<JSON.stringify(new RepVideoList())>}
     */
    async getVideoList(args) {
        const backData = new RepVideoList()
        try {
            const tid = String((args && args.url) || '').trim()
            const page = toInt(args && args.page, 1) || 1
            const r = await this.listAt(tid, page)
            backData.data = r.list
            backData.total = r.total
            // B1：列表为空时必须能分清「真的没内容」和「请求失败」，所以把原因带出去
            if (r.error) backData.error = this.failText('列表获取失败', r.error, r.url)
        } catch (error) {
            backData.error = '获取列表失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    /** hasSubclass=false 时 App 不会调用，留个等价实现以防配置被改 */
    async getSubclassVideoList(args) {
        const backData = new RepVideoList()
        try {
            const mainId = String((args && args.mainClassId) || (args && args.url) || '').trim()
            const page = toInt(args && args.page, 1) || 1
            const r = await this.listAt(mainId, page)
            backData.data = r.list
            backData.total = r.total
            if (r.error) backData.error = this.failText('列表获取失败', r.error, r.url)
        } catch (error) {
            backData.error = '获取列表失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 详情

    /**
     * 获取视频详情
     * @param {UZArgs} args args.url = 详情页 URL（列表里给的 vod_id）
     * @returns {Promise<JSON.stringify(new RepVideoDetail())>}
     */
    async getVideoDetail(args) {
        const backData = new RepVideoDetail()
        try {
            const raw = String((args && args.url) || '').trim()
            const targetUrl = absUrl(raw)
            if (!targetUrl) {
                backData.error = '详情地址为空'
                return JSON.stringify(backData)
            }
            const res = await this.get(targetUrl)
            const html = res.text || ''

            // B5：详情页没取到就报错，不要给一个「标题=正片详情、封面空、点播放必失败」的空壳详情
            if (res.code !== 200) {
                backData.error = this.failText('详情页取回失败', this.describeFailure(res.code, res.error, html), targetUrl)
                return JSON.stringify(backData)
            }
            if (!html) {
                backData.error = this.failText('详情页内容为空', '站点返回 HTTP 200 但正文是空的', targetUrl)
                return JSON.stringify(backData)
            }
            if (this.isCloudflareChallenge(html)) {
                backData.error = this.failText('详情页被人机验证拦住', this.describeFailure(res.code, res.error, html), targetUrl)
                return JSON.stringify(backData)
            }

            // 原 py：<h1> 优先，退 itemprop="name"
            let title = ''
            const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
            if (h1) title = cleanText(h1[1])
            if (!title) {
                const n2 = html.match(/itemprop="name"\s+content="([^"]+)"/i)
                if (n2) title = cleanText(n2[1])
            }
            if (!title) title = '正片详情'

            const cover = this.detailCover(html) // A2
            const durStr = this.detailDuration(html) // A3

            // 原 py 的注释：详情只记页面，播放时再实时解密，避免 token 过期
            const finalDeliver = 'raw_page@@' + targetUrl
            // A8：模板与原版逐字一致，只是不再做 HTML 转义
            const intro =
                '【🔥 蝴蝶影视交流群: ' +
                kTgGroup +
                '】\n' +
                '• 影片标题: ' +
                title +
                '\n' +
                '• 时长: ' +
                (durStr || '完整正片') +
                '\n' +
                '• 源站: bestjavporn.me'

            const v = new VideoDetail()
            v.vod_id = targetUrl
            v.vod_name = title
            v.vod_pic = cover
            v.vod_actor = kBrandActor
            v.vod_director = kBrandDirector
            v.vod_remarks = kBrand
            v.vod_content = intro
            v.vod_play_from = kPlayFrom
            v.vod_play_url = kEpisodeName + '$' + finalDeliver
            backData.data = v
        } catch (error) {
            backData.error = '获取详情失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 播放

    /**
     * 获取播放地址。args.url 就是 vod_play_url 里 `$` 右侧那段（即 raw_page@@<详情页URL>）
     * @param {UZArgs} args
     * @returns {Promise<JSON.stringify(new RepVideoPlayUrl())>}
     */
    async getVideoPlayUrl(args) {
        const backData = new RepVideoPlayUrl()
        try {
            const raw = String((args && args.url) || '').trim()
            let streamUrl = ''
            let reason = '' // B1：解析卡在哪一步，失败时一并告诉用户
            if (raw.indexOf('raw_page@@') === 0) {
                const rs = await this.resolveStream(raw.slice('raw_page@@'.length))
                streamUrl = rs.url
                reason = rs.reason
            } else if (
                raw.indexOf('http') === 0 &&
                (raw.indexOf('.m3u8') !== -1 || raw.indexOf('videplay') !== -1 || raw.indexOf('.mp4') !== -1)
            ) {
                streamUrl = raw
            } else if (raw.indexOf('http') === 0) {
                const rs = await this.resolveStream(raw)
                streamUrl = rs.url
                reason = rs.reason
            }

            if (streamUrl && streamUrl.indexOf('master.m3u8') !== -1) {
                try {
                    streamUrl = await this.preferMediaPlaylist(streamUrl)
                } catch (e) {
                    // 原版也是直接吞掉，失败就用 master
                }
            }

            // 原 py playerContent 的固定头
            const headers = {
                'User-Agent': kUa,
                Referer: gSite + '/',
                Origin: gSite,
                Accept: '*/*',
            }

            if (!streamUrl) {
                // A1：原版这里会返回 parse=1 + 内部标识；uz 没有 parse 语义，改为报错
                // B1：把卡住的原因一起说出来（网络阻断 / 人机验证 / 解密失败 …）
                backData.error = reason ? '解析播放地址失败：' + reason : '解析播放地址失败，请稍后重试或换一部影片'
                return JSON.stringify(backData)
            }
            backData.data = streamUrl
            backData.headers = headers
        } catch (error) {
            backData.error = '解析播放地址失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 搜索

    /**
     * 搜索。原 py 的 searchContent 就是把 `/?s=` 拼出来再转给 categoryContent，
     * 这里同样复用列表解析，只是多了 A4 的空结果识别。
     * @param {UZArgs} args
     * @returns {Promise<JSON.stringify(new RepVideoList())>}
     */
    async searchVideo(args) {
        const backData = new RepVideoList()
        try {
            const page = toInt(args && args.page, 1) || 1
            const q = pyQuote(String((args && args.searchWord) || '').trim())
            const path = page > 1 ? '/page/' + page + '/?s=' + q : '/?s=' + q
            const r = await this.listAt(path, page)
            backData.data = r.list
            backData.total = r.total
            if (r.error) backData.error = this.failText('搜索失败', r.error, r.url)
        } catch (error) {
            backData.error = '搜索失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 内部：列表

    /**
     * 按原 py categoryContent 的规则把 tid + 页码拼成真实 URL
     * @param {string} tid 分类 id，也允许直接给 /path、/?s= 或整条 URL
     * @param {number} page
     */
    buildListUrl(tid, page) {
        const t = String(tid == null ? '' : tid)
        let base
        if (t.indexOf('http') === 0 || t.charAt(0) === '/' || t.indexOf('?s=') === 0) {
            if (t.indexOf('http') === 0) base = t
            else base = gSite + (t.charAt(0) === '/' ? t : '/' + t) // A10
        } else if (kRoute[t]) {
            base = gSite + kRoute[t]
        } else {
            base = gSite + '/category/censored/'
        }
        if (page > 1) {
            if (base.indexOf('filter=') !== -1 || base.indexOf('?s=') !== -1) {
                const sep = base.indexOf('?') !== -1 ? '&' : '?'
                return base + sep + 'paged=' + page
            }
            return base.replace(/\/+$/, '') + '/page/' + page + '/'
        }
        return base
    }

    /**
     * 抓列表页并解析
     * @returns {Promise<{list: VideoDetail[], total: number, url: string, error: string}>}
     *          error 非空 = 这次没拿到可用页面（App 会显示出来）；error 为空 + list 为空 = 确实是空结果
     */
    async listAt(tid, page) {
        const url = this.buildListUrl(tid, page)
        const res = await this.get(url)
        const html = res.text || ''
        // B1：请求层面就失败了，原因翻译成人话带出去（v1 这一步是静默的）
        if (res.code !== 200) {
            return { list: [], total: 0, url: url, error: this.describeFailure(res.code, res.error, html) }
        }
        if (!html) {
            return { list: [], total: 0, url: url, error: '站点返回 HTTP 200，但正文是空的' }
        }
        // 原 py：正文短于 500 字节就当空页面。这里额外把「小得反常」也说出来，便于诊断
        if (html.length < 500) {
            return { list: [], total: 0, url: url, error: '站点返回的页面异常（只有 ' + html.length + ' 字节）' }
        }
        // B2：HTTP 200 也可能是 Cloudflare 挑战页（实测该站 403 与挑战页会交替出现）
        if (this.isCloudflareChallenge(html)) {
            return { list: [], total: 0, url: url, error: this.describeFailure(res.code, res.error, html) }
        }

        if (kGuardEmptyPage && this.isEmptyResultPage(html, page)) {
            return { list: [], total: 0, url: url, error: '' } // A4：这是真的空结果
        }
        const r = this.parseListHtml(html, page)
        r.url = url
        r.error = ''
        return r
    }

    /** A4：识别「空搜索结果页」与「翻过头的 Page not found 页」 */
    isEmptyResultPage(html, page) {
        if (/<h1[^>]*class="[^"]*widget-title[^"]*"[^>]*>\s*Nothing found\s*<\/h1>/i.test(html)) return true
        if (page > 1 && /<title>[^<]*Page not found/i.test(html)) return true
        return false
    }

    /**
     * 列表页解析 —— 原 py categoryContent 的正则逐条照抄
     * @returns {{list: VideoDetail[], total: number}}
     */
    parseListHtml(html, page) {
        // 去掉页头（masthead）与导航，避免把站内菜单当影片
        let scoped = String(html)
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')

        let articles = scoped.match(/<article[^>]*class="[^"]*loop-video[^"]*"[^>]*>[\s\S]*?<\/article>/gi) || []
        if (!articles.length) {
            const parts = scoped.split('thumb-block')
            if (parts.length > 2) articles = parts.slice(1)
        }

        const list = []
        for (let i = 0; i < articles.length; i++) {
            const chunk = articles[i]
            let linkM = chunk.match(/<a[^>]+href=["']([^"']+)["'][^>]*title=["']([^"']*)["']/i)
            let href = ''
            let title = ''
            if (linkM) {
                href = String(linkM[1]).trim()
                title = cleanText(linkM[2])
            } else {
                linkM = chunk.match(/<a[^>]+href=["']([^"']+)["']/i)
                if (!linkM) continue
                href = String(linkM[1]).trim()
            }
            if (!title) {
                const t2 = chunk.match(/<header[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)
                if (t2) title = cleanText(t2[1])
            }
            if (!href || href.indexOf('javascript:') === 0) continue
            const fullHref = absUrl(href)

            const pic = this.wrapImg(this.extractImg(chunk))
            let durM = chunk.match(/class="duration"[^>]*>[\s\S]*?<\/i>\s*([0-9:]+)/i)
            if (!durM) durM = chunk.match(/duration[^>]*>[\s\S]*?([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/i)
            const duration = durM ? cleanText(durM[1]) : ''

            const v = new VideoDetail()
            v.vod_id = fullHref
            v.vod_name = title || '未知片目'
            v.vod_pic = pic
            v.vod_remarks = formatRemarks(kBrand, duration)
            list.push(v)
        }

        // 原 py 的 has_next 判定
        const hasNext =
            new RegExp('/page/' + (page + 1) + '[/"\']').test(scoped) ||
            new RegExp('paged=' + (page + 1)).test(scoped)

        return {
            list: list,
            total: hasNext ? 9999 : list.length,
        }
    }

    //MARK: - 内部：图片

    /** 原 py _extract_img：data-src → data-lazy-src → data-original → src */
    extractImg(chunk) {
        const attrs = ['data-src', 'data-lazy-src', 'data-original', 'src']
        for (let i = 0; i < attrs.length; i++) {
            const m = chunk.match(new RegExp('\\b' + attrs[i] + '=["\']([^"\']+)["\']', 'i'))
            if (m) {
                let val = String(m[1]).trim()
                if (val && val.indexOf('data:') !== 0 && val.indexOf('svg') === -1) {
                    val = toHttps(absUrl(val))
                    return val
                }
            }
        }
        return ''
    }

    /** 原 py _wrap_img，但去掉 TVBox 专有的 @Referer=/@User-Agent= 后缀（A5） */
    wrapImg(imgUrl) {
        if (!imgUrl) return ''
        return toHttps(absUrl(imgUrl))
    }

    /** A2：详情页封面。优先级：og:image → twitter:image → itemprop="thumbnailUrl" → 原逻辑 */
    detailCover(html) {
        const picks = [
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+itemprop=["']thumbnailUrl["'][^>]+content=["']([^"']+)["']/i,
        ]
        for (let i = 0; i < picks.length; i++) {
            const m = html.match(picks[i])
            if (m && String(m[1]).trim()) return this.wrapImg(String(m[1]).trim())
        }
        return this.wrapImg(this.extractImg(html))
    }

    /** A3：详情页本片时长。itemprop="duration"(ISO8601) → #video-date 的 `Duration: HH:MM:SS` */
    detailDuration(html) {
        const iso = html.match(/<meta[^>]+itemprop=["']duration["'][^>]+content=["']([^"']+)["']/i)
        if (iso) {
            const c = isoDurationToClock(iso[1])
            if (c) return c
        }
        const d = html.match(/Duration:\s*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/i)
        if (d) return cleanText(d[1])
        return ''
    }

    //MARK: - 内部：播放链路

    /**
     * 原 py _resolve_stream
     * 顺序：页面里直接给的 m3u8（排除 preview）→ 嵌入页 pox/dp 解密 → 嵌入页裸 m3u8
     * @param {string} pageUrl 详情页 URL
     * @param {string} [html] 已经拿到的详情页 HTML
     * @returns {Promise<{url: string, reason: string}>} url 为空时 reason 说明卡在哪一步
     */
    async resolveStream(pageUrl, html) {
        let pageHtml = html
        if (!pageHtml) {
            const res = await this.get(pageUrl)
            pageHtml = res.text || ''
            if (res.code !== 200) {
                return { url: '', reason: '详情页取回失败（' + this.describeFailure(res.code, res.error, pageHtml) + '）' }
            }
        }
        if (!pageHtml) return { url: '', reason: '详情页正文是空的' }
        if (this.isCloudflareChallenge(pageHtml)) {
            return { url: '', reason: '详情页被人机验证拦住（' + this.describeFailure(200, '', pageHtml) + '）' }
        }

        const m3 = pageHtml.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/)
        if (m3 && String(m3[1]).toLowerCase().indexOf('preview') === -1) return { url: m3[1], reason: '' }

        const embed = this.extractEmbedUrl(pageHtml)
        if (!embed) return { url: '', reason: '详情页里找不到播放页地址（站点结构可能变了）' }
        const emb = await this.get(embed, pageUrl)
        const embHtml = emb.text || ''
        if (emb.code !== 200) {
            return { url: '', reason: '播放页取回失败（' + this.describeFailure(emb.code, emb.error, embHtml) + '）' }
        }
        if (this.isCloudflareChallenge(embHtml)) {
            return { url: '', reason: '播放页被人机验证拦住（' + this.describeFailure(200, '', embHtml) + '）' }
        }

        const poxM = embHtml.match(/let\s+pox\s*=\s*['"]([^'"]+)['"]/)
        const dpM = embHtml.match(/let\s+dp\s*=\s*['"]([^'"]+)['"]/)
        if (poxM && dpM) {
            const stream = bestjavAesDecrypt(poxM[1], dpM[1])
            if (stream && (stream.indexOf('m3u8') !== -1 || stream.indexOf('http') === 0)) {
                return { url: stream.trim().replace(/^"|"$/g, ''), reason: '' }
            }
            // 到这说明 pox/dp 有，但解密没出来 —— 留个原因，别让用户两手空空
            const m3c = embHtml.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/)
            if (m3c) return { url: m3c[1], reason: '' }
            return { url: '', reason: '播放页解密失败（pox/dp 变了或密钥对不上）' }
        }

        const m3b = embHtml.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/)
        if (m3b) return { url: m3b[1], reason: '' }
        return { url: '', reason: '播放页里没有 m3u8 地址（站点结构可能变了）' }
    }

    /** 原 py _extract_embed_url */
    extractEmbedUrl(html) {
        const m = html.match(/data-rocketlazyloadscript=['"]data:text\/javascript;base64,([A-Za-z0-9+/=]+)['"]/)
        if (m) {
            try {
                const js = decodeBase64Utf8(m[1])
                const um = js.match(/defaultUrl\s*=\s*["']([^"']+)["']/)
                if (um) return toHttps(um[1])
            } catch (e) {
                // 载荷解不开就走下面的兜底
            }
        }
        const m2 = html.match(/(https?:\/\/[^"'\s]+\/xx\/[A-Za-z0-9]+)/)
        if (m2) return toHttps(m2[1])
        return ''
    }

    /**
     * 原 py _prefer_media_playlist：master.m3u8 里挑 BANDWIDTH 最大的 variant
     * （原正则 `#EXT-X-STREAM-INF:([^\n]*)\n([^\s]+)` 就是两个捕获组，配对解包没写错）
     */
    async preferMediaPlaylist(masterUrl) {
        if (!masterUrl || masterUrl.indexOf('master.m3u8') === -1) return masterUrl
        const res = await this.get(masterUrl, gSite + '/')
        const text = res.text || ''
        if (!text || text.indexOf('#EXTM3U') === -1) return masterUrl

        const pairs = []
        const re = /#EXT-X-STREAM-INF:([^\n]*)\n([^\s]+)/g
        let mm
        while ((mm = re.exec(text)) !== null) pairs.push(mm)
        if (!pairs.length) return masterUrl

        const idx = masterUrl.lastIndexOf('/')
        const base = idx === -1 ? masterUrl : masterUrl.slice(0, idx + 1)
        let bestU = ''
        let bestBw = -1
        for (let i = 0; i < pairs.length; i++) {
            let u = String(pairs[i][2]).trim()
            if (u.indexOf('http') !== 0) u = base + u
            const bwM = String(pairs[i][1]).match(/BANDWIDTH=(\d+)/)
            const bw = bwM ? parseInt(bwM[1], 10) : 0
            if (bw >= bestBw) {
                bestBw = bw
                bestU = u
            }
        }
        return bestU || masterUrl
    }

    //MARK: - 内部：网络

    /**
     * 拼请求头。attempt=0 用原 py 的默认头；attempt>0 换「更像浏览器」的一套（B4）
     */
    headersFor(browserLike, referer) {
        const base = browserLike ? this.kBrowserHeaders : this.kHeaders
        const headers = {}
        const keys = Object.keys(base)
        for (let i = 0; i < keys.length; i++) headers[keys[i]] = base[keys[i]]
        headers.Referer = referer || gSite + '/'
        return headers
    }

    /** B3/B4：每次尝试的 req 选项 */
    buildReqOptions(attempt, referer) {
        const options = {
            headers: this.headersFor(attempt > 0, referer),
            sendTimeout: kTimeoutMs,
            receiveTimeout: kTimeoutMs,
        }
        // B4：第 2 次不强制 HTTP2 —— 同一 URL 换请求特征实测会得到不同结果
        if (attempt > 0) options.useHttp2 = false
        return options
    }

    /**
     * 这次失败还值不值得换特征再试一次。
     * 网络层直接失败（连请求都没落地）和 403/408/5xx 值得再试；
     * 404/410 这种站点给的明确答复再试也没用。
     */
    shouldRetry(code) {
        if (!(code > 0)) return true // 0 / -1：网络层就失败了
        if (code === 403 || code === 408) return true
        if (code >= 500) return true
        return false
    }

    /**
     * B2：识别 Cloudflare 挑战页。真站页面 58–85KB，挑战页约 5.7KB，所以加个体量上限防误判。
     */
    isCloudflareChallenge(html) {
        const s = String(html == null ? '' : html)
        if (!s || s.length > kChallengeMaxLen) return false
        if (/<title>\s*(Just a moment|Attention Required)/i.test(s)) return true
        if (s.indexOf('cf_chl_') !== -1 || s.indexOf('__cf_chl') !== -1) return true
        if (s.indexOf('Checking your browser before accessing') !== -1) return true
        return false
    }

    /** 把 req 的 error 尾巴拼成 `：xxx`（没有就不拼） */
    errTail(error) {
        const e = String(error == null ? '' : error).trim()
        return e ? '：' + e : ''
    }

    /**
     * B1/B2：把一次请求失败翻译成用户看得懂的中文原因。
     * 注意 uz 的 req 在**网络层失败**时也会给 code=500（不是 HTTP 500），
     * 所以「500 且带 error」判为网络失败，「500 且无 error」才是真的服务器 500。
     * @param {number} code HTTP 状态码 / uz 的 0、408、500
     * @param {string} error req 给的错误消息
     * @param {string} text 响应正文（用来认 Cloudflare 挑战页）
     */
    describeFailure(code, error, text) {
        const body = String(text == null ? '' : text)
        if (this.isCloudflareChallenge(body)) {
            return '站点的人机验证页拦住了请求（Cloudflare），当前网络访问不了，请换网络或开代理后重试'
        }
        if (code === 403) return '站点返回 403（拒绝访问），可能是屏蔽了当前网络/地区，或触发了人机验证'
        if (code === 429) return '站点返回 429（请求太频繁），请稍后重试'
        if (code === 408) return '请求超时（' + kTimeoutMs + ' 毫秒内没有响应）'
        if (code === 404) return '站点返回 404（页面不存在）'
        if (!(code > 0)) return '网络请求失败' + this.errTail(error) + ' —— 站点可能被网络阻断，需要代理'
        if (code >= 500 && error) return '网络请求失败' + this.errTail(error) + ' —— 站点可能被网络阻断，需要代理'
        return '站点返回 HTTP ' + code
    }

    /** B1：统一把失败文案拼成「前缀：原因 + 请求地址」 */
    failText(prefix, msg, url) {
        let s = prefix + '：' + msg
        if (url) s += '\n请求地址：' + url
        return s
    }

    /**
     * 原 py _fetch（含「最多 2 次」的重试）
     * @returns {Promise<{code:number, text:string, error:string, ct:string}>}
     *          error / ct 是 v2 新增的附带信息（B1），成功路径的返回内容与 v1 相同
     */
    async get(url, referer) {
        const target = absUrl(url)
        if (!target) return { code: 0, text: '', error: '地址为空', ct: '' }

        let out = { code: -1, text: '', error: '', ct: '' }
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const pro = await req(target, this.buildReqOptions(attempt, referer))
                const code = pro && pro.code ? pro.code : 0
                const hd = (pro && pro.headers) || {}
                out = {
                    code: code,
                    text: pro && typeof pro.data === 'string' ? pro.data : '',
                    error: String((pro && pro.error) || ''),
                    ct: String(hd['content-type'] || hd['Content-Type'] || ''),
                }
            } catch (e) {
                out = { code: -1, text: '', error: (e && e.message) ? String(e.message) : String(e), ct: '' }
            }
            if (out.code === 200) return out
            // 原 py 只对「抛异常」重试；req 不走异常，所以这里用「网络层失败 / 403」来等价判断
            if (!this.shouldRetry(out.code)) return out
        }
        return out
    }
}
let bestjav2026 = new bestjavClass()
