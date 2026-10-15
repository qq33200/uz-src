// ignore
//@name:911爆料
//@webSite:https://catch.belwfufv.cc
//@version:1
//@remark:911爆料网（catch.belwfufv.cc）TVBox py 源移植。23 个吃瓜/爆料分类 + 站内搜索 + 分页；详情页从播放器 data-config 里取正片 HLS 直链。原版重度依赖 TVBox 的 localProxy + AES 解密来代理封面，uz 没有这套机制，故：① 列表页**不出封面**（实测该站封面全部是 AES 加密图、单张约 155KB、30 张 base64 后要 6MB，塞进列表会拖垮加载，且站点没有任何缩略图/明文路径可选、query 参数也被忽略），标题信息量足够，列表因此只发 1 个请求、秒开；② 详情页会**现拉现解**那一张封面（uz 官方支持 data:image base64 封面，实测解密结果就是合法 JPEG）。域名池会波动（同一批 7 个域名，一次实测 3 个活、隔一会儿 6 个活），故按顺序自愈。正片直链实测是「每次重签发但长期有效」的形态（同一把地址 10 分钟后仍可用），故详情直接给直链、播放时挂了再回详情重取。v1。
//@order: M
//@codeID:
//@env:
//@isAV:1
//@deprecated:0
// ignore

// ignore
// 不支持导入，这里只是本地开发用于代码提示
// 如需添加通用依赖，请联系 https://t.me/uzVideoAppbot
import {
    FilterLabel,
    FilterTitle,
    VideoClass,
    VideoSubclass,
    VideoDetail,
    RepVideoClassList,
    RepVideoSubclassList,
    RepVideoList,
    RepVideoDetail,
    RepVideoPlayUrl,
    UZArgs,
    UZSubclassVideoListArgs,
} from '../../core/uzVideo.js'

import { UZUtils, ProData, ReqResponseType, ReqAddressType, req, getEnv, setEnv, toast } from '../../core/uzUtils.js'

import { cheerio, Crypto, Encrypt, JSONbig } from '../../core/uz3lib.js'
// ignore

/**
 * 911爆料网 —— TVBox py 源 → uz 视频源扩展
 *
 * 与 py 原版的差异只有两处，都是 uz 环境决定的：
 *   ① 图片：原版走 localProxy 现解密，uz 没有这个口子。列表页不出封面（成本见 remark），
 *      详情页现拉现解一张，拼成 data:image/...;base64, —— uz 官方文档明确支持这种封面。
 *   ② 播放：原版给两条一模一样的线路（911爆料 / 备用解析），这里只留一条。
 */

//MARK: - 常量

const appConfig = {
    ver: 1,
    webSite: 'https://catch.belwfufv.cc',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
    brand: '911爆料',
    siteName: '911爆料网',
}

/** 域名池（照搬原版顺序，但把实测最稳的排前面）。会波动，见自愈逻辑 */
const b9Hosts = [
    'https://catch.belwfufv.cc',
    'https://911bl.com',
    'https://911bla.com',
    'https://d10cq29fdobmmg.cloudfront.net',
    'https://carry.cyepzjnb.com',
    'https://admire.cyepzjnb.com',
    'https://911bl16.com',
]

/** 封面的 AES-128-CBC 参数（与原版一致；官方同族源 Jin_91jav 用的也是这一对） */
const b9AesKey = 'f5d965df75336270'
const b9AesIv = '97b60394abc2fbe1'

const b9Timeout = 15000

/** 列表页广告位标题（原版 AD_KEYWORDS 的精简版） */
const b9AdTitles = [
    'app', '911爆料app', '下载app', '官方推荐', '加入911', '章鱼导航', '欲洛降临',
    '七夕活动', '911暑期活动', '回家的路', '投稿方式', '常见问题', '广告商务',
    '所有标签', '关于我们', '官方tg群', '官方推特', 'ai换脸脱衣', '广告', '商务合作',
]

let b9Healed = ''

//MARK: - 小工具

function b9ToStr(v) {
    if (v === null || v === undefined) {
        return ''
    }
    return String(v)
}

function b9ErrText(e) {
    if (!e) {
        return '未知错误'
    }
    if (e.message) {
        return String(e.message)
    }
    return String(e)
}

function b9HtmlDecode(s) {
    let t = b9ToStr(s)
    if (!t || t.indexOf('&') === -1) {
        return t
    }
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#34': '"' }
    t = t.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, g) {
        if (named[g] !== undefined) {
            return named[g]
        }
        if (g.charAt(0) === '#') {
            const hex = g.charAt(1) === 'x' || g.charAt(1) === 'X'
            const n = parseInt(hex ? g.slice(2) : g.slice(1), hex ? 16 : 10)
            if (!isNaN(n) && n > 0 && n < 65536) {
                return String.fromCharCode(n)
            }
        }
        return m
    })
    return t
}

function b9Site() {
    return b9Healed || appConfig.webSite
}

function b9Headers(extra) {
    const h = {
        'User-Agent': appConfig.ua,
        Referer: b9Site() + '/',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
    if (extra) {
        const ks = Object.keys(extra)
        for (let i = 0; i < ks.length; i++) {
            h[ks[i]] = extra[ks[i]]
        }
    }
    return h
}

function b9Text(p) {
    if (!p) {
        return ''
    }
    const d = p.data
    if (typeof d === 'string') {
        return d
    }
    if (d) {
        try {
            return JSON.stringify(d)
        } catch (e) {
            return ''
        }
    }
    return ''
}

function b9Ok(p) {
    if (!p) {
        return false
    }
    try {
        if (typeof p.ok === 'function' && p.ok()) {
            return true
        }
    } catch (e) {
        /* 忽略 */
    }
    return typeof p.code === 'number' && p.code >= 200 && p.code < 300
}

async function b9Req(url, opts) {
    const o = opts || {}
    try {
        const p = await req(url, {
            headers: b9Headers(o.headers),
            sendTimeout: o.timeout || b9Timeout,
            receiveTimeout: o.timeout || b9Timeout,
            responseType: o.responseType,
        })
        return { ok: b9Ok(p), code: (p && p.code) || 0, text: b9Text(p), raw: p, error: (p && p.error) || '' }
    } catch (e) {
        return { ok: false, code: -1, text: '', raw: null, error: '请求异常：' + b9ErrText(e) }
    }
}

/**
 * 域名池自愈：按 b9Hosts 顺序试到第一个能出文章列表的域名，缓存在会话里。
 * 列表/详情/搜索都走这里，任何一个域名挂了会清掉缓存、下次重新挑。
 */
async function b9Page(path, referer) {
    const hosts = []
    if (b9Healed) {
        hosts.push(b9Healed)
    }
    for (let i = 0; i < b9Hosts.length; i++) {
        if (hosts.indexOf(b9Hosts[i]) === -1) {
            hosts.push(b9Hosts[i])
        }
    }
    let last = { ok: false, code: 0, text: '', error: '没有可用的域名' }
    for (let i = 0; i < hosts.length; i++) {
        const host = hosts[i].replace(/\/+$/, '')
        const url = path.charAt(0) === '/' ? host + path : host + '/' + path
        const r = await b9Req(url, { headers: { Referer: referer || host + '/' } })
        if (r.ok && r.text && r.text.indexOf('/archives/') !== -1) {
            b9Healed = host
            return r
        }
        last = r
    }
    b9Healed = ''
    last.error = (last.error || '请求失败') + '（已试 ' + hosts.length + ' 个域名）'
    return last
}

//MARK: - 封面解密

function b9WaToBytes(wa) {
    const words = wa.words
    const len = wa.sigBytes
    const out = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
    }
    return out
}

function b9Magic(b) {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
        return 'jpeg'
    }
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
        return 'png'
    }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
        return 'gif'
    }
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
        return 'webp'
    }
    return ''
}

/**
 * /xiao/ 下的图是 AES-128-CBC 整图加密的。解密用 **NoPadding**：
 * 实测这些图本来就是 16 字节整数倍、明文里没有 PKCS7 填充，
 * 用 Pkcs7 反而会被多剥 3 个字节把 JPEG 尾部切坏（实测 84512 → 84509）。
 * 解不出图片魔数就返回空串（宁可不出图，也不要给出一张裂图）。
 */
async function b9Cover(url) {
    const u = b9ToStr(url).trim()
    if (!u) {
        return ''
    }
    if (u.indexOf('/xiao/') === -1) {
        return u
    }
    const r = await b9Req(u, { responseType: 'arraybuffer', timeout: 10000, headers: { Referer: b9Site() + '/' } })
    if (!r.ok || !r.raw || !r.raw.data) {
        return ''
    }
    let bytes
    try {
        bytes = new Uint8Array(r.raw.data)
    } catch (e) {
        return ''
    }
    if (!bytes.length || bytes.length % 16 !== 0) {
        return ''
    }
    let dec = null
    try {
        const b64 = Crypto.enc.Base64.stringify(Crypto.lib.WordArray.create(bytes))
        dec = Crypto.AES.decrypt(b64, Crypto.enc.Utf8.parse(b9AesKey), {
            iv: Crypto.enc.Utf8.parse(b9AesIv),
            mode: Crypto.mode.CBC,
            padding: Crypto.pad.NoPadding,
        })
    } catch (e) {
        return ''
    }
    if (!dec) {
        return ''
    }
    const mime = b9Magic(b9WaToBytes(dec))
    if (!mime) {
        return ''
    }
    try {
        return 'data:image/' + mime + ';base64,' + Crypto.enc.Base64.stringify(dec)
    } catch (e) {
        return ''
    }
}

//MARK: - 分类

const b9Classes = [
    { id: 'category/jrgb', name: '今日大瓜' },
    { id: 'category/mrds', name: '每日大赛' },
    { id: 'category/hjsq', name: '海角社区' },
    { id: 'category/aidj', name: 'AI短剧' },
    { id: 'category/crfys', name: '午夜剧场' },
    { id: 'category/dmhv', name: '动漫天堂' },
    { id: 'category/sgpjs', name: '水果派解说' },
    { id: 'category/rmgb', name: '独家爆料' },
    { id: 'category/rlph', name: '黑料排行' },
    { id: 'category/ssdbl', name: '热点吃瓜' },
    { id: 'category/xyss', name: '校园吃瓜' },
    { id: 'category/bgzq', name: '反差爆料' },
    { id: 'category/whbl', name: '网红黑料' },
    { id: 'category/mxhl', name: '明星吃瓜' },
    { id: 'category/blqw', name: '猎奇吃瓜' },
    { id: 'category/tksm', name: '偷窥泄密' },
    { id: 'category/zksr', name: 'SM专区' },
    { id: 'category/ntll', name: '男男女女' },
    { id: 'category/thjx', name: '探花经典' },
    { id: 'category/fljq', name: '福利视频' },
    { id: 'category/crlz', name: '网黄专辑' },
    { id: 'category/slec', name: '影视床戏' },
    { id: 'category/kpzj', name: '看片专辑' },
]

//MARK: - 列表解析

/** 按 <article> 切块；标题取 h2.post-card-title，备注取 itemprop=datePublished */
function b9Cards(html) {
    const h = b9ToStr(html)
    const out = []
    const seen = {}
    const blocks = h.split(/<article\b/i)
    for (let i = 1; i < blocks.length; i++) {
        const b = blocks[i]
        const mh = b.match(/\/archives\/(\d+)/)
        if (!mh) {
            continue
        }
        const id = mh[1]
        if (seen[id]) {
            continue
        }
        let title = ''
        const mt =
            b.match(/<h2[^>]*class="[^"]*post-card-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) ||
            b.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
        if (mt) {
            title = b9HtmlDecode(mt[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
        }
        if (!title) {
            continue
        }
        let ad = false
        const low = title.toLowerCase()
        for (let z = 0; z < b9AdTitles.length; z++) {
            if (low === b9AdTitles[z]) {
                ad = true
                break
            }
        }
        if (ad) {
            continue
        }
        let remark = ''
        const md =
            b.match(/<span[^>]*itemprop="datePublished"[^>]*>([\s\S]*?)<\/span>/i) ||
            b.match(/<time[^>]*>([\s\S]*?)<\/time>/i)
        if (md) {
            remark = b9HtmlDecode(md[1].replace(/<[^>]+>/g, ''))
                .replace(/\s+/g, ' ')
                .replace(/[•·、]\s*$/, '')
                .trim()
        }
        let raw = ''
        const mp = b.match(/loadBannerDirect\(['"]([^'"]+)['"]/)
        if (mp) {
            raw = mp[1]
        }
        seen[id] = 1
        out.push({ id: id, title: title, remark: remark, raw: raw })
    }
    return out
}

function b9Remarks(r) {
    const t = b9ToStr(r).replace(/[\r\n\t]+/g, ' ').trim()
    return t ? appConfig.brand + ' | ' + t : appConfig.brand
}

function b9ListFrom(cards) {
    const out = []
    for (let i = 0; i < cards.length; i++) {
        const c = cards[i]
        const vd = new VideoDetail()
        vd.vod_id = c.id
        vd.vod_name = c.title
        // 列表页不出封面（见 //@remark）：加密图单张约 155KB、30 张 base64 后约 6MB
        vd.vod_pic = ''
        vd.vod_remarks = b9Remarks(c.remark)
        out.push(vd)
    }
    return out
}

//MARK: - 详情解析

function b9ParseDetail(html) {
    const h = b9ToStr(html)
    let title = ''
    const t1 = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (t1) {
        title = b9HtmlDecode(t1[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    }
    if (!title) {
        const t2 = h.match(/<title>([\s\S]*?)<\/title>/i)
        if (t2) {
            title = b9HtmlDecode(b9ToStr(t2[1]).split(' - ')[0]).replace(/\s+/g, ' ').trim()
        }
    }

    let play = ''
    let rawPic = ''
    const mc = h.match(/data-config='(\{[\s\S]*?\})'/) || h.match(/data-config="(\{[\s\S]*?\})"/)
    if (mc) {
        const cfgText = b9HtmlDecode(mc[1])
        let cfg = null
        try {
            cfg = JSON.parse(cfgText)
        } catch (e) {
            cfg = null
        }
        if (cfg && cfg.video) {
            play = b9ToStr(cfg.video.url).split('\\/').join('/').split('\\').join('').trim()
            rawPic = b9ToStr(cfg.video.pic).split('\\/').join('/').split('\\').join('').trim()
        }
        if (!play) {
            // data-config 不是合法 JSON 时退回正则（原版的做法，但收紧到只认 video 段）
            const mr = cfgText.match(/"video"\s*:\s*\{[\s\S]*?"url"\s*:\s*"([^"]+)"/)
            if (mr) {
                play = b9ToStr(mr[1]).split('\\/').join('/').split('\\').join('').trim()
            }
        }
    }
    if (!play) {
        const md = h.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i)
        if (md) {
            play = md[1].split('\\/').join('/').split('\\').join('').trim()
        }
    }

    let desc = ''
    const mde =
        h.match(/<meta[^>]+(?:name|property)=["'](?:og:description|description)["'][^>]+content=["']([^"']*)["']/i) ||
        h.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:og:description|description)["']/i)
    if (mde) {
        desc = b9HtmlDecode(mde[1])
    }

    let remark = ''
    const mdd = h.match(/<span[^>]*itemprop="datePublished"[^>]*>([\s\S]*?)<\/span>/i)
    if (mdd) {
        remark = b9HtmlDecode(mdd[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').replace(/[•·、]\s*$/, '').trim()
    }

    return { title: title, play: play, pic: rawPic, desc: desc, remark: remark }
}

//MARK: - 接口实现

/**
 * 获取分类
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoClassList())
 */
async function getClassList(args) {
    var backData = new RepVideoClassList()
    try {
        const list = []
        for (let i = 0; i < b9Classes.length; i++) {
            const vc = new VideoClass()
            vc.type_id = b9Classes[i].id
            vc.type_name = b9Classes[i].name
            vc.hasSubclass = false
            list.push(vc)
        }
        backData.data = list
    } catch (error) {
        backData.error = '获取分类失败～' + b9ErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 本站在分类里没有二级筛选
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoSubclassList())
 */
async function getSubclassList(args) {
    var backData = new RepVideoSubclassList()
    try {
        const sub = new VideoSubclass()
        sub.class = []
        sub.filter = []
        backData.data = sub
    } catch (error) {
        backData.error = '获取筛选项失败～' + b9ErrText(error)
    }
    return JSON.stringify(backData)
}

async function b9List(backData, tid, page) {
    let clean = b9ToStr(tid).replace(/^\/+|\/+$/g, '') || 'category/jrgb'
    if (clean.indexOf('category/') !== 0) {
        clean = 'category/' + clean
    }
    const path = page > 1 ? '/' + clean + '/' + page + '/' : '/' + clean + '/'
    const r = await b9Page(path)
    if (!r.ok || !r.text) {
        backData.error = '列表获取失败：' + (r.error || '接口没有返回数据')
        return
    }
    const cards = b9Cards(r.text)
    backData.data = b9ListFrom(cards)
    backData.pagecount = cards.length >= 10 ? page + 1 : page
    if (!cards.length) {
        backData.error = '这个分类的第 ' + page + ' 页没有内容了'
    }
}

/**
 * 分类视频列表
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function getVideoList(args) {
    var backData = new RepVideoList()
    try {
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        await b9List(backData, args && args.url, page)
    } catch (error) {
        backData.error = '获取列表失败～' + b9ErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 本站在分类里没有二级筛选，直接转发给普通列表
 * @param {UZSubclassVideoListArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function getSubclassVideoList(args) {
    var backData = new RepVideoList()
    try {
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        await b9List(backData, (args && (args.mainClassId || args.url)) || 'category/jrgb', page)
    } catch (error) {
        backData.error = '获取列表失败～' + b9ErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 详情：正片直链直接从播放器 data-config 里取；封面现拉现解一张
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoDetail())
 */
async function getVideoDetail(args) {
    var backData = new RepVideoDetail()
    try {
        const raw = b9ToStr(args && args.url)
        const mid = raw.match(/(\d+)/)
        if (!mid) {
            backData.error = '缺少文章编号'
            return JSON.stringify(backData)
        }
        const id = mid[1]
        const r = await b9Page('/archives/' + id + '/')
        if (!r.ok || !r.text) {
            backData.error = '详情获取失败：' + (r.error || '接口没有返回数据')
            return JSON.stringify(backData)
        }
        const info = b9ParseDetail(r.text)

        const vd = new VideoDetail()
        vd.vod_id = id
        vd.vod_name = info.title || '911爆料 ' + id
        vd.vod_pic = await b9Cover(info.pic)
        vd.vod_actor = appConfig.brand
        vd.vod_director = appConfig.brand
        vd.vod_remarks = b9Remarks(info.remark || '在线播放')
        vd.vod_content = info.desc
        vd.vod_play_from = '911爆料'
        vd.vod_play_url = '在线播放$' + encodeURIComponent(info.play) + '@@' + encodeURIComponent(id)
        if (!info.play) {
            backData.error = '这个页面里没有解析到播放地址'
        }
        backData.data = vd
    } catch (error) {
        backData.error = '获取详情失败～' + b9ErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 播放：直链有效就直接用；挂了回详情页重取一把（该站每次请求都会重签发地址）
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoPlayUrl())
 */
async function getVideoPlayUrl(args) {
    var backData = new RepVideoPlayUrl()
    try {
        const parts = b9ToStr(args && args.url).split('@@')
        function dec(s) {
            try {
                return decodeURIComponent(b9ToStr(s))
            } catch (e) {
                return b9ToStr(s)
            }
        }
        let url = dec(parts[0])
        const id = dec(parts[1])

        if (url) {
            const probe = await b9Req(url, { timeout: 9000, headers: { Range: 'bytes=0-1' } })
            if (probe.ok && (probe.code === 200 || probe.code === 206)) {
                backData.data = url
                backData.headers = { 'User-Agent': appConfig.ua, Referer: b9Site() + '/' }
                return JSON.stringify(backData)
            }
        }
        if (id) {
            const r = await b9Page('/archives/' + id + '/')
            if (r.ok && r.text) {
                const fresh = b9ParseDetail(r.text).play
                if (fresh) {
                    backData.data = fresh
                    backData.headers = { 'User-Agent': appConfig.ua, Referer: b9Site() + '/' }
                    return JSON.stringify(backData)
                }
            }
        }
        if (!url) {
            backData.error = '没有可用的播放地址（页面里没有解析到直链）'
            return JSON.stringify(backData)
        }
        backData.data = url
        backData.headers = { 'User-Agent': appConfig.ua, Referer: b9Site() + '/' }
    } catch (error) {
        backData.error = '获取播放地址失败～' + b9ErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 搜索（实测该站搜索页没有分页：/search/<kw>/2/ 与第 1 页返回同一批内容，故只给一页）
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function searchVideo(args) {
    var backData = new RepVideoList()
    try {
        const kw = b9ToStr(args && args.searchWord).trim()
        if (!kw) {
            return JSON.stringify(backData)
        }
        const r = await b9Page('/search/' + encodeURIComponent(kw) + '/')
        if (!r.ok || !r.text) {
            backData.error = '搜索失败：' + (r.error || '没有返回数据')
            return JSON.stringify(backData)
        }
        const cards = b9Cards(r.text)
        backData.data = b9ListFrom(cards)
        backData.pagecount = 1
        if (!cards.length) {
            backData.error = '没有搜到「' + kw + '」相关内容'
        }
    } catch (error) {
        backData.error = '搜索失败～' + b9ErrText(error)
    }
    return JSON.stringify(backData)
}
