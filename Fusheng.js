// ignore
//@name:浮生影院
//@webSite:https://tv.fushengr.cc
//@version:1
//@remark:浮生影院（tv.fushengr.cc）TVBox py 源移植。12 个一级分类（每类带细分子频道筛选）+ 站内搜索；详情页从 window.__ARCHIVE_PLAYER__ 取正片路径、从 var cdn_lines 取多线路。按实测做的三处修正：① 站点分类页其实没有分页（?page=N 与 /page/N/ 返回的完全是同一批内容，后者甚至 404），原版照着「翻页」写会无限翻同一页，故每类只给一页；② 原版硬编码的兜底线路 d32bg2g0w9aqg4.cloudfront.net 已死（连接直接失败），已换成实测可用的 vsdsq.tjacq.com；③ 站点 cdn_lines 里第二条线的地址本身是坏的（https:/dfdf.tjacq.com，少一个斜杠），已过滤，避免点开必失败。播放直链实测为静态地址（两次取详情完全一致），故详情直接给直链，播放时先探一次、挂了再回详情重取。v1。
//@order: L
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
 * 浮生影院（tv.fushengr.cc）—— TVBox py 源 → uz 视频源扩展
 *
 * 原链路：
 *   分类   homeContent     → 12 个一级分类（各自带细分子频道）
 *   列表   categoryContent → /group-category/<tid>/  或  /category/<sub>/
 *   详情   detailContent   → window.__ARCHIVE_PLAYER__ 的 rawPath + var cdn_lines 的多线路
 *   播放   playerContent   → 直链 + Referer
 *   搜索   searchContent   → /search/<kw>/
 */

//MARK: - 常量

const appConfig = {
    ver: 1,
    webSite: 'https://tv.fushengr.cc',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    brand: '蝴蝶影视',
    tg: 'https://t.me/tvshare23',
    siteName: '浮生影院',
}

/** 备用发布页（原版用于自愈；实测该页已无任何 /video/ 链接，仅保留作最后兜底） */
const fsPublishUrl = 'https://madou2025.com'

/** 兜底线路：实测可用（原版硬编码的 d32bg2g0w9aqg4.cloudfront.net 已死，已剔除） */
const fsFallbackLines = [['播放线路01', 'https://vsdsq.tjacq.com']]

const fsTimeout = 15000

let fsHealedHost = ''

//MARK: - 小工具

function fsToStr(v) {
    if (v === null || v === undefined) {
        return ''
    }
    return String(v)
}

function fsErrText(e) {
    if (!e) {
        return '未知错误'
    }
    if (e.message) {
        return String(e.message)
    }
    return String(e)
}

/** 把 JSON 里的 \/ 全部还原成 /（JS 的 String.replace(字符串) 只换第一处，必须用 split/join） */
function fsSlash(s) {
    return fsToStr(s).split('\\/').join('/').split('\\').join('')
}

function fsHtmlDecode(s) {
    let t = fsToStr(s)
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

function fsSite() {
    return fsHealedHost || appConfig.webSite
}

function fsAbs(u) {
    const s = fsToStr(u).trim()
    if (!s) {
        return ''
    }
    if (s.indexOf('//') === 0) {
        return 'https:' + s
    }
    if (s.charAt(0) === '/') {
        return fsSite() + s
    }
    if (!/^https?:\/\//i.test(s)) {
        return fsSite() + '/' + s
    }
    return s
}

/**
 * 规范化 CDN 基础域名。
 * 站点的 cdn_lines 里第二条线是 URL 编码残缺的 `https:/dfdf.tjacq.com`（少一个斜杠），
 * 这种直接判无效丢掉 —— 否则会多出一条「点开必失败」的线路。
 */
function fsFixBase(b) {
    const s = fsSlash(b).trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\/\s]+$/i.test(s)) {
        return ''
    }
    return s
}

function fsHeaders(extra) {
    const h = {
        'User-Agent': appConfig.ua,
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

/** 判成功只看 code —— 不用 error 判（实测成功时 error 也可能有值） */
async function fsFetch(url, referer, opts) {
    const o = opts || {}
    const options = {
        headers: fsHeaders({ Referer: referer || fsSite() + '/' }),
        sendTimeout: o.timeout || fsTimeout,
        receiveTimeout: o.timeout || fsTimeout,
    }
    if (o.range) {
        options.headers.Range = o.range
    }
    let p = null
    try {
        p = await req(url, options)
    } catch (e) {
        return { ok: false, code: -1, text: '', error: '请求异常：' + fsErrText(e) }
    }
    const code = p && typeof p.code === 'number' ? p.code : 0
    let ok = false
    try {
        if (p && typeof p.ok === 'function') {
            ok = !!p.ok()
        }
    } catch (e) {
        ok = false
    }
    if (!ok && code >= 200 && code < 300) {
        ok = true
    }
    let text = ''
    const d = p ? p.data : null
    if (typeof d === 'string') {
        text = d
    } else if (d) {
        try {
            text = JSON.stringify(d)
        } catch (e) {
            text = ''
        }
    }
    return { ok: ok, code: code, text: text, error: (p && p.error) || '' }
}

/** 请求站内页面：主域名挂了就试一次备用发布页里出现的同族域名；都失败就报错 */
async function fsPage(path, referer) {
    const order = [fsSite()]
    if (fsHealedHost && fsHealedHost !== appConfig.webSite) {
        order.push(appConfig.webSite)
    }
    let last = { ok: false, code: 0, text: '', error: '没有可用的站点域名' }
    for (let i = 0; i < order.length; i++) {
        const host = order[i].replace(/\/+$/, '')
        const u = path.charAt(0) === '/' ? host + path : host + '/' + path
        last = await fsFetch(u, referer || host + '/')
        if (last.ok && last.text) {
            if (host !== fsSite()) {
                fsHealedHost = host
            }
            return last
        }
    }
    return last
}

/** 站点自愈：主域名不通时，从备用发布页里找一个 fusheng 同族域名 */
async function fsHeal() {
    if (fsHealedHost) {
        return fsHealedHost
    }
    const probe = await fsFetch(appConfig.webSite + '/')
    if (probe.ok) {
        return appConfig.webSite
    }
    const pub = await fsFetch(fsPublishUrl + '/')
    if (!pub.ok || !pub.text) {
        return ''
    }
    const cands = pub.text.match(/https?:\/\/[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}/g) || []
    for (let i = 0; i < cands.length; i++) {
        const c = cands[i].replace(/\/+$/, '')
        if (c.indexOf('fusheng') === -1) {
            continue
        }
        const r = await fsFetch(c + '/')
        if (r.ok) {
            fsHealedHost = c
            return c
        }
    }
    return ''
}

//MARK: - 分类表（照搬原版 homeContent）

const fsClasses = [
    { id: 'cate29', name: '一手原创' },
    { id: 'cate37', name: '独家热播' },
    { id: 'cate17', name: '乱伦之爱' },
    { id: 'cate47', name: '福利姬' },
    { id: 'cate65', name: '优选UP' },
    { id: 'cate81', name: 'P站精选' },
    { id: 'cate98', name: '国产传媒' },
    { id: 'cate113', name: '日本AV' },
    { id: 'cate129', name: '性癖' },
    { id: 'cate138', name: '动漫' },
    { id: 'cate148', name: '欧美' },
    { id: 'cate162', name: '劲爆综艺' },
]

/** 细分子频道（照搬原版 filters） */
const fsSubs = {
    cate29: [
        ['御姐李老师', 'cate31'], ['奶气草莓', 'cate32'], ['会喷水的姐姐', 'cate33'],
        ['伊藤诚', 'cate34'], ['狠台北', 'cate35'], ['公鸡俱乐部', 'cate36'],
    ],
    cate37: [
        ['颜值女神', 'cate39'], ['探花嫖妓', 'cate40'], ['绿帽淫妻', 'cate41'], ['母狗性奴', 'cate42'],
        ['针孔偷拍', 'cate43'], ['野战户外', 'cate44'], ['成人综艺', 'cate45'], ['网红骚播', 'cate46'],
    ],
    cate17: [
        ['鬼父操女', 'cate19'], ['淫母兽儿', 'cate20'], ['嫂子诱惑', 'cate21'],
        ['姐夫小姨子', 'cate22'], ['爷孙禁忌', 'cate26'],
    ],
    cate65: [
        ['菠萝啤beer~', 'cate67'], ['网红妹妹', 'cate68'], ['香艳职场', 'cate69'], ['捅主任', 'cate70'],
        ['双生の恋', 'cate71'], ['台湾臀后艾丽', 'cate72'], ['粉红兔的诱惑', 'cate73'], ['COS美少女', 'cate74'],
        ['女王梨奈', 'cate75'], ['性感小猫咪', 'cate76'], ['宜家门', 'cate77'], ['颜射少女', 'cate78'],
        ['迷奸柚', 'cate79'], ['拳交女皇', 'cate80'],
    ],
    cate81: [
        ['米胡桃', 'cate83'], ['Andmlove', 'cate84'], ['羞羞兔', 'cate85'], ['Roko', 'cate86'],
        ['Yominokuni', 'cate87'], ['桃子派', 'cate88'], ['下面有根棒棒糖', 'cate89'], ['宝贝奶兽', 'cate90'],
        ['BabyYurin', 'cate91'], ['优咪Yumi', 'cate92'], ['台湾兔兔', 'cate93'], ['爱玩熊熊', 'cate94'],
        ['鸡教练', 'cate95'], ['樱桃空空', 'cate96'], ['Miuzxc', 'cate97'],
    ],
    cate98: [['精东影业', 'cate108']],
    cate113: [['凌辱快感', 'cate121']],
    cate129: [
        ['SM调教', 'cate131'], ['媚黑骚逼', 'cate132'], ['强奸迷奸', 'cate133'], ['人妖伪娘', 'cate134'],
        ['百合女同', 'cate135'], ['男男之恋', 'cate136'], ['偷窥偷拍', 'cate137'],
    ],
    cate138: [
        ['王者荣耀', 'cate140'], ['经典老片', 'cate141'], ['禁漫里番', 'cate142'], ['巨乳动漫', 'cate143'],
        ['中文字幕', 'cate144'], ['魔', 'cate145'], ['原神', 'cate146'], ['综合', 'cate147'],
    ],
    cate162: [
        ['性爱自修室', 'cate164'], ['突袭女优家', 'cate165'], ['淫娃培训营', 'cate166'],
        ['淫欲游戏王', 'cate167'], ['情趣K歌房', 'cate168'], ['乱伦家庭', 'cate169'],
    ],
}

//MARK: - 卡片解析

function fsRemarks(dur) {
    const d = fsToStr(dur).replace(/[\r\n\t]+/g, ' ').trim()
    return d ? appConfig.brand + ' | ' + d : appConfig.brand
}

/**
 * 卡片：<a ...href="/video/<id>/" aria-label="标题"> … <img data-src="封面"> … <span class="fg2-duration">22:45</span> … </a>
 * 标题按 aria-label → title → <strong> → alt 依次取（照搬原版优先级）
 */
function fsCards(html) {
    const h = fsToStr(html)
    const out = []
    const seen = {}
    const re = /<a\b([^>]*?href=["'][^"']*?\/video\/(\d+)\/?["'][^>]*)>([\s\S]*?)<\/a>/gi
    let m = re.exec(h)
    while (m) {
        const attrs = m[1]
        const vid = m[2]
        const inner = m[3]
        if (seen[vid]) {
            m = re.exec(h)
            continue
        }
        let name = ''
        const cands = [
            /aria-label=["']([^"']+)["']/i,
            /title=["']([^"']+)["']/i,
            /<(?:strong|em|h\d)[^>]*>([\s\S]*?)<\/(?:strong|em|h\d)>/i,
            /alt=["']([^"']+)["']/i,
        ]
        for (let i = 0; i < cands.length; i++) {
            const mm = (attrs + ' ' + inner).match(cands[i])
            if (mm) {
                const t = fsHtmlDecode(fsToStr(mm[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
                if (t) {
                    name = t
                    break
                }
            }
        }
        if (!name) {
            m = re.exec(h)
            continue
        }
        let pic = ''
        const pm = inner.match(/data-src=["']([^"']+)["']/i) || inner.match(/<img[^>]+src=["']([^"']+)["']/i)
        if (pm && fsToStr(pm[1]).indexOf('loading.gif') === -1) {
            pic = fsAbs(pm[1])
        }
        let dur = ''
        const dm = inner.match(/class=["'][^"']*duration[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
        if (dm) {
            dur = fsToStr(dm[1]).replace(/<[^>]+>/g, '').trim()
        }
        seen[vid] = 1
        out.push({ vid: vid, name: name, pic: pic, dur: dur })
        m = re.exec(h)
    }
    return out
}

function fsListFrom(cards) {
    const out = []
    for (let i = 0; i < cards.length; i++) {
        const c = cards[i]
        const vd = new VideoDetail()
        vd.vod_id = c.vid
        vd.vod_name = c.name
        vd.vod_pic = c.pic
        vd.vod_remarks = fsRemarks(c.dur)
        out.push(vd)
    }
    return out
}

//MARK: - 列表

/**
 * 站点其实没有分页：实测 /group-category/<tid>/?page=1..60 与 /category/<sub>/?page=N
 * 返回的是完全相同的一批内容（唯一 vid 数一致、集合完全相等），而 /page/N/ 这种写法直接 404。
 * 所以这里只给一页，pagecount 固定 1，避免 App 无限翻同一页。
 */
async function fsList(backData, tid, page, sub) {
    let path
    if (sub) {
        path = '/category/' + sub + '/'
    } else {
        path = '/group-category/' + (tid || 'cate29') + '/'
    }
    const r = await fsPage(path)
    if (!r.ok || !r.text) {
        backData.error = '列表获取失败：' + (r.error || '接口没有返回数据')
        return
    }
    const cards = fsCards(r.text)
    backData.data = fsListFrom(cards)
    if (!cards.length) {
        backData.error = '这个分类下没有解析到内容'
    }
}

//MARK: - 详情 / 播放

/**
 * 从详情页抽出播放路径与全部线路。
 *
 * 详情页里：
 *   window.__ARCHIVE_PLAYER__ = {"rawPath":"\/video\/…m3u8","posterImg":"…","cdnLine":"https://…",…}
 *   var cdn_lines = '[{"cdnLine":"https:\/\/…","cdnName":"国际线路02","lineName":"国际线路02"},…]'
 * cdn_lines 那串本身是合法 JSON（\/ 就是 JSON 的合法转义），可以直接 JSON.parse。
 */
function fsParseDetail(html) {
    const h = fsToStr(html)
    let path = ''
    let poster = ''
    const lines = []

    const pm = h.match(/window\.__ARCHIVE_PLAYER__\s*=\s*(\{[\s\S]*?\});/)
    if (pm) {
        try {
            const j = JSON.parse(pm[1])
            path = fsSlash(j.rawPath)
            poster = fsSlash(j.posterImg)
            const base = fsFixBase(j.cdnLine)
            if (base) {
                lines.push({ name: '线路1', base: base })
            }
        } catch (e) {
            path = path || ''
        }
    }
    if (!path) {
        const dm = h.match(/['"](\/video\/[^'"]+?\.m3u8)['"]/)
        if (dm) {
            path = dm[1]
        }
    }

    const cm = h.match(/var\s+cdn_lines\s*=\s*'([^']+)'/) || h.match(/var\s+cdn_lines\s*=\s*"([^"]+)"/)
    if (cm) {
        try {
            const arr = JSON.parse(cm[1])
            if (arr && arr.length) {
                for (let i = 0; i < arr.length; i++) {
                    const it = arr[i] || {}
                    const base = fsFixBase(it.cdnLine)
                    if (!base) {
                        continue
                    }
                    lines.push({ name: fsToStr(it.lineName || it.cdnName || '线路' + (i + 1)), base: base })
                }
            }
        } catch (e) {
            /* cdn_lines 不是合法 JSON 时忽略，用下面的兜底 */
        }
    }

    // 兜底线路补在后面
    for (let i = 0; i < fsFallbackLines.length; i++) {
        lines.push({ name: fsFallbackLines[i][0], base: fsFallbackLines[i][1] })
    }

    // 按 base 去重，并保序
    const seen = {}
    const uniq = []
    for (let i = 0; i < lines.length; i++) {
        if (seen[lines[i].base]) {
            continue
        }
        seen[lines[i].base] = 1
        uniq.push(lines[i])
    }

    let title = ''
    const tm = h.match(/<title>([\s\S]*?)<\/title>/i)
    if (tm) {
        title = fsHtmlDecode(fsToStr(tm[1]).split('-')[0].replace(/\s+/g, ' ').trim())
    }

    return { path: path, poster: poster, lines: uniq, title: title }
}

function fsPackPlay(url, vid) {
    return encodeURIComponent(url || '') + '@@' + encodeURIComponent(vid || '')
}

function fsUnpackPlay(raw) {
    const parts = fsToStr(raw).split('@@')
    function dec(s) {
        try {
            return decodeURIComponent(fsToStr(s))
        } catch (e) {
            return fsToStr(s)
        }
    }
    return { url: dec(parts[0]), vid: dec(parts[1]) }
}

function fsPlayOk(backData, url) {
    backData.data = url
    backData.headers = { 'User-Agent': appConfig.ua, Referer: fsSite() + '/' }
    return JSON.stringify(backData)
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
        await fsHeal()
        const list = []
        for (let i = 0; i < fsClasses.length; i++) {
            const vc = new VideoClass()
            vc.type_id = fsClasses[i].id
            vc.type_name = fsClasses[i].name
            const subs = fsSubs[fsClasses[i].id]
            vc.hasSubclass = !!(subs && subs.length)
            list.push(vc)
        }
        backData.data = list
    } catch (error) {
        backData.error = '获取分类失败～' + fsErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 细分子频道
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoSubclassList())
 */
async function getSubclassList(args) {
    var backData = new RepVideoSubclassList()
    try {
        const sub = new VideoSubclass()
        sub.class = []
        const tid = fsToStr(args && args.url).trim() || 'cate29'
        const subs = fsSubs[tid] || []
        const ft = new FilterTitle()
        ft.name = '细分子频道'
        const all = new FilterLabel()
        all.name = '全部'
        all.id = ''
        const arr = [all]
        for (let i = 0; i < subs.length; i++) {
            const fl = new FilterLabel()
            fl.name = subs[i][0]
            fl.id = subs[i][1]
            arr.push(fl)
        }
        ft.list = arr
        sub.filter = [ft]
        backData.data = sub
    } catch (error) {
        backData.error = '获取筛选项失败～' + fsErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 分类视频列表（无筛选）
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function getVideoList(args) {
    var backData = new RepVideoList()
    try {
        await fsList(backData, args && args.url, 1, '')
    } catch (error) {
        backData.error = '获取列表失败～' + fsErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 分类视频列表（带筛选）
 * @param {UZSubclassVideoListArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function getSubclassVideoList(args) {
    var backData = new RepVideoList()
    try {
        let sub = ''
        const f = (args && args.filter) || []
        if (f.length > 0 && f[0]) {
            sub = fsToStr(f[0].id)
        }
        const tid = (args && (args.mainClassId || args.url)) || 'cate29'
        await fsList(backData, tid, 1, sub)
    } catch (error) {
        backData.error = '获取列表失败～' + fsErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 详情：给出全部线路的直链（实测直链是静态的，不随时间变）
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoDetail())
 */
async function getVideoDetail(args) {
    var backData = new RepVideoDetail()
    try {
        const vid = fsToStr(args && args.url).replace(/[^0-9]/g, '')
        if (!vid) {
            backData.error = '缺少影片编号'
            return JSON.stringify(backData)
        }
        const r = await fsPage('/video/' + vid + '/')
        if (!r.ok || !r.text) {
            backData.error = '详情获取失败：' + (r.error || '接口没有返回数据')
            return JSON.stringify(backData)
        }
        const info = fsParseDetail(r.text)

        const froms = []
        const urls = []
        for (let i = 0; i < info.lines.length; i++) {
            if (!info.path) {
                break
            }
            const full = info.lines[i].base + info.path
            froms.push(info.lines[i].name)
            urls.push('超清正片$' + fsPackPlay(full, vid))
        }

        const vd = new VideoDetail()
        vd.vod_id = vid
        vd.vod_name = info.title || '浮生影院 ' + vid
        vd.vod_pic = info.poster
        vd.vod_actor = '🦋 ' + appConfig.tg.replace('https://t.me/', 'TG群: @')
        vd.vod_director = '🦋 ' + appConfig.brand
        vd.vod_remarks = fsRemarks('正片直链')
        vd.vod_content =
            '【🔥 官方交流群: ' +
            appConfig.tg +
            '】\n【当前站点: ' +
            fsSite() +
            '】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n蝴蝶专线 直链极速秒播'
        vd.vod_play_from = froms.length ? froms.join('$$$') : '浮生专线'
        vd.vod_play_url = urls.length ? urls.join('$$$') : '超清正片$' + fsPackPlay('', vid)
        if (!froms.length) {
            backData.error = '详情页里没有解析到播放地址（可能已下架）'
        }
        backData.data = vd
    } catch (error) {
        backData.error = '获取详情失败～' + fsErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 播放：先探一次直链，挂了就回详情页重取（线路会变，实测原版硬编码的那条已死）
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoPlayUrl())
 */
async function getVideoPlayUrl(args) {
    var backData = new RepVideoPlayUrl()
    try {
        const got = fsUnpackPlay(args && args.url)
        let url = got.url
        if (url) {
            const probe = await fsFetch(url, fsSite() + '/', { timeout: 9000, range: 'bytes=0-1' })
            if (probe.ok && (probe.code === 200 || probe.code === 206)) {
                return fsPlayOk(backData, url)
            }
        }
        // 直链挂了（或压根没带）→ 回详情页重取一遍，换一条能用的线路
        if (got.vid) {
            const r = await fsPage('/video/' + got.vid + '/')
            if (r.ok && r.text) {
                const info = fsParseDetail(r.text)
                for (let i = 0; i < info.lines.length; i++) {
                    const full = info.lines[i].base + info.path
                    const p2 = await fsFetch(full, fsSite() + '/', { timeout: 9000, range: 'bytes=0-1' })
                    if (p2.ok && (p2.code === 200 || p2.code === 206)) {
                        return fsPlayOk(backData, full)
                    }
                }
            }
        }
        if (!url) {
            backData.error = '没有可用的播放地址（详情页没有解析出直链）'
            return JSON.stringify(backData)
        }
        return fsPlayOk(backData, url)
    } catch (error) {
        backData.error = '获取播放地址失败～' + fsErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 搜索
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function searchVideo(args) {
    var backData = new RepVideoList()
    try {
        const kw = fsToStr(args && args.searchWord).trim()
        if (!kw) {
            return JSON.stringify(backData)
        }
        const r = await fsPage('/search/' + encodeURIComponent(kw) + '/')
        if (!r.ok || !r.text) {
            backData.error = '搜索失败：' + (r.error || '没有返回数据')
            return JSON.stringify(backData)
        }
        const cards = fsCards(r.text)
        backData.data = fsListFrom(cards)
        if (!cards.length) {
            backData.error = '没有搜到「' + kw + '」相关内容'
        }
    } catch (error) {
        backData.error = '搜索失败～' + fsErrText(error)
    }
    return JSON.stringify(backData)
}
