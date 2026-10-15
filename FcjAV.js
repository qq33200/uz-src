// ignore
//@name:FCJAV（挂梯）
//@webSite:https://fcjav.com
//@version:2
//@remark:FCJAV（fcjav.com）TVBox py 源移植，16 个分类 + 站内搜索 + 分页。播放链路比原版深了两层，已按实测重写：详情页取 filmId/__pt/__pk → POST /ajax/player 拿 player_enc → base64+XOR(pk) 解出播放器 iframe → iframe 里的 data-api（f4stream v2 播放器，原版找的 var urlPlay 已不存在）→ GET /api/play/<id>?ab=0&ad=0&n=1 换播放地址。三条实测结论都写进了实现：① 这条链路上「ab/ad/r 参数缺一个就 403」；② n=1 才是给原生播放器（无 MSE）的开放链接，不加 n 时 /v/<token> 会因缺 Origin 被 403；③ 换来的 /v/<token> 只活 300 秒（实测 T+300s 变 410 Playback link expired），而 pt 疑似一次性（响应里带 next_pt/next_pk），故播放标识只存必要的几个字段、播放时现走链路，绝不存会过期的地址。v2：给取数加了网络层重试（3 次 / 退避 300ms、600ms）——实测同一地址连打 20 次会偶发 1 次 TLS 抖动（EPROTO），而本源此前一次抖动就整页报「列表获取失败」，多个同类老源都带这一层，这里补齐。v1（初版）。
//@order: K
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
 * FCJAV（fcjav.com）—— TVBox py 源 → uz 视频源扩展
 *
 * 播放链路（照实测，不是照原版代码）：
 *   1. 详情页 /v/<slug>            → filmId、__pt、__pk、线路(源 id + 剧集 id)
 *   2. POST /ajax/player           → form 体 episode=&filmId=&pt=  →  {player_enc, next_pt, next_pk}
 *   3. base64 解码 + 逐字节 XOR(pk) → 播放器 iframe 的 src
 *   4. GET iframe                  → data-api="/api/play/<videoId>"（f4stream v2 播放器）
 *   5. GET /api/play/<id>?ab=0&ad=0&n=1&r=<站点>  → {url:"/v/<token>", type:"hls", expires_in:300}
 *   6. https://f4s.top + /v/<token> 就是 m3u8（原生 UA 直接可拉，不需要 Origin）
 */

//MARK: - 常量

const appConfig = {
    ver: 1,
    webSite: 'https://fcjav.com',
    ua: 'Mozilla/5.0 (Linux; Android 14; 22127RK46C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    /** /api/play 走 n=1（原生播放器 / 无 MSE 分支），实测用 iOS UA 拿到的就是开放链接 */
    playerUa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
    brand: 'FCJAV',
    siteName: 'FCJAV',
}

const fjTimeout = 15000

/** 站点筛选走的路径与别的分类不同的两个 */
const fjGenreTids = ['uncensored-leaked', 'reducing-mosaic']

/**
 * 网络层重试：站点/链路偶发 RST、TLS 抖动时重试，避免「一次抖动 = 整页失败」。
 * 依据：本机同时对同一地址连打 20 次，实测 19/20（1 次 EPROTO）；
 * 所有同族老源（GetAV / 蝴蝶影院 / CartoonPorno / Lmm）都带这一层，这里补齐。
 * 只对「网络层失败 / 5xx / 408 / 429 / 空响应」重试，明确的 4xx 直接返回不浪费请求。
 */
const fjTries = 3

function fjRetryable(r) {
    if (!r) {
        return true
    }
    if (r.error) {
        return true
    }
    const c = r.code
    if (c === 0 || c < 0 || c === 408 || c === 429 || c >= 500) {
        return true
    }
    if (c >= 400 && c < 500) {
        return false
    }
    return !r.text
}

function fjSleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms)
    })
}

//MARK: - 小工具

function fjToStr(v) {
    if (v === null || v === undefined) {
        return ''
    }
    return String(v)
}

function fjErrText(e) {
    if (!e) {
        return '未知错误'
    }
    if (e.message) {
        return String(e.message)
    }
    return String(e)
}

function fjHtmlDecode(s) {
    let t = fjToStr(s)
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

function fjHeaders(extra, ua) {
    const h = {
        'User-Agent': ua || appConfig.ua,
        Referer: appConfig.webSite + '/',
    }
    if (extra) {
        const ks = Object.keys(extra)
        for (let i = 0; i < ks.length; i++) {
            h[ks[i]] = extra[ks[i]]
        }
    }
    return h
}

function fjText(p) {
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

function fjOk(p) {
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

async function fjGet(url, extraHeaders, opts) {
    const o = opts || {}
    let last = { ok: false, code: 0, text: '', error: '未请求' }
    for (let attempt = 1; attempt <= fjTries; attempt++) {
        try {
            const p = await req(url, {
                headers: fjHeaders(extraHeaders, o.ua),
                sendTimeout: o.timeout || fjTimeout,
                receiveTimeout: o.timeout || fjTimeout,
            })
            last = { ok: fjOk(p), code: (p && p.code) || 0, text: fjText(p), error: (p && p.error) || '' }
        } catch (e) {
            last = { ok: false, code: -1, text: '', error: '请求异常：' + fjErrText(e) }
        }
        if (last.ok && last.text) {
            return last
        }
        if (attempt >= fjTries || !fjRetryable(last)) {
            return last
        }
        await fjSleep(300 * attempt)
    }
    return last
}

/**
 * 🔴 form POST 必须走**字符串** data（真机 req 把 options 原样交给原生侧，
 * 官方 Zhi_qiyou.js 就是这么发的），服务端读的是 $_POST。
 */
async function fjPost(url, body, referer) {
    let last = { ok: false, code: 0, text: '', raw: null, error: '未请求' }
    for (let attempt = 1; attempt <= fjTries; attempt++) {
        try {
            const p = await req(url, {
                method: 'post',
                headers: {
                    'User-Agent': appConfig.ua,
                    Referer: referer || appConfig.webSite + '/',
                    'X-Requested-With': 'XMLHttpRequest',
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                },
                data: body,
                sendTimeout: fjTimeout,
                receiveTimeout: fjTimeout,
            })
            last = { ok: fjOk(p), code: (p && p.code) || 0, text: fjText(p), raw: p, error: (p && p.error) || '' }
        } catch (e) {
            last = { ok: false, code: -1, text: '', raw: null, error: '请求异常：' + fjErrText(e) }
        }
        if (last.ok && last.text) {
            return last
        }
        if (attempt >= fjTries || !fjRetryable(last)) {
            return last
        }
        await fjSleep(300 * attempt)
    }
    return last
}

/** base64 → 字节数组（手写，不依赖 atob） */
function fjB64ToBytes(s) {
    const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const src = fjToStr(s).replace(/[^A-Za-z0-9+/=]/g, '')
    const out = []
    let buf = 0
    let bits = 0
    for (let i = 0; i < src.length; i++) {
        const c = src.charAt(i)
        if (c === '=') {
            break
        }
        const v = map.indexOf(c)
        if (v === -1) {
            continue
        }
        buf = (buf << 6) | v
        bits += 6
        if (bits >= 8) {
            bits -= 8
            out.push((buf >> bits) & 0xff)
        }
    }
    return out
}

function fjBytesToUtf8(bytes) {
    let s = ''
    for (let i = 0; i < bytes.length; i++) {
        const h = bytes[i].toString(16)
        s += '%' + (h.length < 2 ? '0' + h : h)
    }
    try {
        return decodeURIComponent(s)
    } catch (e) {
        let t = ''
        for (let i = 0; i < bytes.length; i++) {
            t += String.fromCharCode(bytes[i])
        }
        return t
    }
}

/** player_enc：base64 → 与 pk 的 ASCII 逐字节循环 XOR → 明文 HTML */
function fjDecodePlayerEnc(enc, pk) {
    const raw = fjB64ToBytes(enc)
    const key = fjToStr(pk)
    if (!raw.length || !key.length) {
        return ''
    }
    const out = []
    for (let i = 0; i < raw.length; i++) {
        out.push(raw[i] ^ key.charCodeAt(i % key.length))
    }
    return fjBytesToUtf8(out)
}

function fjAbs(u) {
    const s = fjToStr(u).trim()
    if (!s) {
        return ''
    }
    if (s.indexOf('//') === 0) {
        return 'https:' + s
    }
    if (/^https?:\/\//i.test(s)) {
        return s
    }
    return appConfig.webSite + (s.charAt(0) === '/' ? '' : '/') + s
}

function fjOrigin(u) {
    const m = fjToStr(u).match(/^(https?:\/\/[^\/]+)/i)
    return m ? m[1] : ''
}

//MARK: - 分类

const fjClasses = [
    { id: 'movies', name: '最新' },
    { id: 'amateur', name: '业余' },
    { id: 'censored', name: '有码' },
    { id: 'uncensored', name: '无码' },
    { id: 'reducing-mosaic', name: '减薄马赛克' },
    { id: 'uncensored-leaked', name: '无码流出' },
    { id: 'genre/amateur', name: '素人' },
    { id: 'genre/anal', name: '肛交' },
    { id: 'genre/av-idol', name: 'AV女优' },
    { id: 'genre/beautiful-girl', name: '美少女' },
    { id: 'genre/big-tits', name: '巨乳' },
    { id: 'genre/blowjob', name: '口交' },
    { id: 'genre/cosplay', name: 'Cosplay' },
    { id: 'genre/creampie', name: '中出' },
    { id: 'genre/cumshot', name: '颜射' },
    { id: 'genre/bondage', name: '束缚' },
]

/** 照搬原版 _build_cat_url（含两个必须走 /genre/ 的筛选） */
function fjCatUrl(tid, page) {
    const p = page > 0 ? page : 1
    const t = fjToStr(tid) || 'movies'
    const host = appConfig.webSite
    if (t.indexOf('genre/') === 0) {
        return host + '/' + t + (p > 1 ? '/pg-' + p : '')
    }
    if (t === 'movies') {
        return host + '/movies' + (p > 1 ? '/pg-' + p : '')
    }
    if (fjGenreTids.indexOf(t) !== -1) {
        return host + '/genre/' + t + (p > 1 ? '/pg-' + p : '')
    }
    return host + '/movies?genre=' + t + (p > 1 ? '&pg=' + p : '')
}

//MARK: - 列表解析

function fjClean(html) {
    return fjToStr(html)
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
}

function fjParseList(html) {
    const h = fjClean(html)
    const out = []
    const blocks = h.split('<div class="ml-item">')
    for (let i = 1; i < blocks.length; i++) {
        const b = blocks[i]
        const ml = b.match(/href="([^"]*\/v\/[^"]+)"/)
        if (!ml) {
            continue
        }
        const link = ml[1]
        const vid = link.replace(/\/+$/, '').split('/v/').pop()
        if (!vid) {
            continue
        }
        let name = ''
        const mt = b.match(/<a[^>]+class="ml-mask[^"]*"[^>]*title="([^"]*)"/) || b.match(/title="([^"]*)"/)
        if (mt) {
            name = fjHtmlDecode(mt[1]).trim()
        }
        if (!name) {
            name = vid
        }
        let pic = ''
        const mp = b.match(/data-original="([^"]+)"/) || b.match(/<img[^>]+src="([^"]+)"/)
        if (mp) {
            pic = fjAbs(mp[1])
        }
        let remark = ''
        const mr = b.match(/class="mli-runtimes"[^>]*>([^<]+)</) || b.match(/class="mli-code"[^>]*>([^<]+)</)
        if (mr) {
            remark = mr[1].replace(/\s+/g, ' ').trim()
        }
        out.push({ vid: vid, name: name, pic: pic, remark: remark })
    }
    return out
}

function fjPageCount(html) {
    const h = fjToStr(html)
    const seg0 = h.match(/<ul[^>]*class=['"]pagination['"][^>]*>[\s\S]*?<\/ul>/)
    const seg = seg0 ? seg0[0] : h
    let max = 0
    const re = /pg[-=](\d+)/g
    let m = re.exec(seg)
    while (m) {
        const n = parseInt(m[1], 10)
        if (!isNaN(n) && n > max) {
            max = n
        }
        m = re.exec(seg)
    }
    if (max > 0) {
        return max
    }
    const mo = seg.match(/of\s+(\d+)/)
    if (mo) {
        const n = parseInt(mo[1], 10)
        if (!isNaN(n)) {
            return n
        }
    }
    return 0
}

function fjRemarks(r) {
    const t = fjToStr(r).replace(/[\r\n\t]+/g, ' ').trim()
    return t ? appConfig.brand + ' | ' + t : appConfig.brand
}

function fjListFrom(cards) {
    const out = []
    for (let i = 0; i < cards.length; i++) {
        const c = cards[i]
        const vd = new VideoDetail()
        vd.vod_id = c.vid
        vd.vod_name = c.name
        vd.vod_pic = c.pic
        vd.vod_remarks = fjRemarks(c.remark)
        out.push(vd)
    }
    return out
}

//MARK: - 详情解析

function fjParseDetail(html) {
    const h = fjToStr(html)
    let name = ''
    const m1 = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (m1) {
        name = fjHtmlDecode(m1[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    }
    if (!name) {
        const m2 = h.match(/<title>([\s\S]*?)<\/title>/i)
        if (m2) {
            name = fjHtmlDecode(m2[1].replace(/\s*[-|]\s*FCJAV.*$/i, '')).replace(/\s+/g, ' ').trim()
        }
    }
    let pic = ''
    const pats = [/og:image"\s+content="([^"]+)"/i, /data-poster="([^"]+)"/i, /<img[^>]+class="cover"[^>]+src="([^"]+)"/i]
    for (let i = 0; i < pats.length; i++) {
        const mm = h.match(pats[i])
        if (mm) {
            pic = fjAbs(mm[1])
            break
        }
    }
    let content = ''
    const mc = h.match(/name="description"\s+content="([^"]*)"/i) || h.match(/property="og:description"\s+content="([^"]*)"/i)
    if (mc) {
        content = fjHtmlDecode(mc[1])
    }
    let remark = ''
    const mr = h.match(/class="mli-runtimes"[^>]*>([^<]+)</)
    if (mr) {
        remark = mr[1].replace(/\s+/g, ' ').trim()
    }
    const filmId = (h.match(/filmId\s*=\s*(\d+)/) || [null, ''])[1]
    const pt = (h.match(/__pt\s*=\s*"([^"]+)"/) || [null, ''])[1]
    const pk = (h.match(/__pk\s*=\s*"([^"]+)"/) || [null, ''])[1]

    let eps = h.match(/class="switch-source[^"]*"\s+data-source="(\d+)"\s+data-id="(\d+)"[^>]*>[\s\S]*?<\/button>/g) || []
    const names = []
    const pairs = []
    if (eps.length) {
        for (let i = 0; i < eps.length; i++) {
            const pair = eps[i].match(/data-source="(\d+)"\s+data-id="(\d+)"/)
            if (pair) {
                pairs.push([pair[1], pair[2]])
            }
            const nm = eps[i].match(/<\/i>\s*([A-Za-z0-9]+)\s*<\/button>/)
            names.push(nm ? nm[1] : '')
        }
    } else {
        const re = /data-source="(\d+)"\s+data-id="(\d+)"/g
        let m = re.exec(h)
        while (m) {
            pairs.push([m[1], m[2]])
            names.push('')
            m = re.exec(h)
        }
    }
    return { name: name, pic: pic, content: content, remark: remark, filmId: filmId, pt: pt, pk: pk, eps: pairs, names: names }
}

//MARK: - 播放标识

/**
 * 标识 = src|eid|vid|filmId|pt|pk
 * 这 6 个字段都是当场从详情页取到的（pt/pk 疑似一次性，响应里还带 next_pt/next_pk），
 * 所以播放时优先直接用它们，失败再回详情页重取一次 —— 不存任何会过期的播放地址。
 */
function fjPackPlay(src, eid, vid, filmId, pt, pk) {
    return [src, eid, vid, filmId, pt, pk].join('|')
}

function fjUnpackPlay(raw) {
    const p = fjToStr(raw).split('|')
    return {
        src: p[0] || '',
        eid: p[1] || '',
        vid: p[2] || '',
        filmId: p[3] || '',
        pt: p[4] || '',
        pk: p[5] || '',
    }
}

function fjPlayOk(backData, url, referer) {
    backData.data = url
    backData.headers = { 'User-Agent': appConfig.ua, Referer: referer || appConfig.webSite + '/' }
    return JSON.stringify(backData)
}

/** 走完整链路换一次播放地址；任何一环失败都返回 {url:'', iframe:''} 而不是抛异常 */
async function fjResolve(got) {
    const detailUrl = appConfig.webSite + '/v/' + got.vid
    let filmId = got.filmId
    let pt = got.pt
    let pk = got.pk
    let src = got.src
    let eid = got.eid

    if (!filmId || !pt || !pk || !eid) {
        const d = await fjGet(detailUrl, { Referer: appConfig.webSite + '/movies' })
        if (!d.ok || !d.text) {
            return { url: '', iframe: '', reason: '详情页请求失败：' + (d.error || '无数据') }
        }
        const info = fjParseDetail(d.text)
        filmId = filmId || info.filmId
        pt = pt || info.pt
        pk = pk || info.pk
        if (info.eps.length) {
            if (!eid) {
                eid = info.eps[0][1]
            }
            if (!src) {
                src = info.eps[0][0]
            }
        }
    }
    if (!filmId || !pt || !pk || !eid) {
        return { url: '', iframe: '', reason: '详情页缺少 filmId/pt/pk（可能已下架）' }
    }

    const body = 'episode=' + eid + '&filmId=' + filmId + '&pt=' + pt
    const pr = await fjPost(appConfig.webSite + '/ajax/player', body, detailUrl)
    if (!pr.ok || !pr.text) {
        return { url: '', iframe: '', reason: '取播放凭据失败：' + (pr.error || 'HTTP ' + pr.code) }
    }
    let j = null
    try {
        j = JSON.parse(pr.text)
    } catch (e) {
        return { url: '', iframe: '', reason: '播放凭据不是合法 JSON' }
    }
    if (!j || j.error) {
        return { url: '', iframe: '', reason: '站点返回错误：' + ((j && j.error) || '未知') }
    }
    let iframeHtml = ''
    if (j.player_enc) {
        iframeHtml = fjDecodePlayerEnc(j.player_enc, pk)
    } else if (j.player) {
        iframeHtml = fjToStr(j.player)
    }
    const mIframe = iframeHtml.match(/src="([^"]+)"/)
    if (!mIframe) {
        return { url: '', iframe: '', reason: '解密后没找到播放器 iframe' }
    }
    const iframeUrl = fjAbs(mIframe[1])
    const origin = fjOrigin(iframeUrl)

    const ih = await fjGet(iframeUrl, { Referer: appConfig.webSite + '/' })
    if (!ih.ok || !ih.text) {
        return { url: '', iframe: iframeUrl, reason: '播放器页面请求失败' }
    }
    const mApi = ih.text.match(/data-api="([^"]+)"/)
    let videoId = (ih.text.match(/data-video-id="([^"]+)"/) || [null, ''])[1]
    if (!videoId && mApi) {
        videoId = mApi[1].replace(/\/+$/, '').split('/').pop()
    }
    if (!videoId) {
        return { url: '', iframe: iframeUrl, reason: '播放器页面里没有 data-api' }
    }

    // ab/ad/r 三个参数缺一个就 403（实测）；n=1 = 给原生播放器（无 MSE）的开放链接
    const apiUrl =
        origin +
        '/api/play/' +
        videoId +
        '?ab=0&ad=0&n=1&r=' +
        encodeURIComponent(appConfig.webSite + '/')
    const ar = await fjGet(apiUrl, { Accept: 'application/json', Referer: iframeUrl }, { ua: appConfig.playerUa })
    if (!ar.ok || !ar.text) {
        return { url: '', iframe: iframeUrl, reason: '取播放地址失败：HTTP ' + ar.code }
    }
    let aj = null
    try {
        aj = JSON.parse(ar.text)
    } catch (e) {
        return { url: '', iframe: iframeUrl, reason: '播放地址接口不是合法 JSON' }
    }
    if (!aj || !aj.url) {
        return { url: '', iframe: iframeUrl, reason: '播放地址接口没有返回 url' }
    }
    let finalUrl = fjToStr(aj.url)
    if (finalUrl.charAt(0) === '/') {
        finalUrl = origin + finalUrl
    } else if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = origin + '/' + finalUrl
    }
    return { url: finalUrl, iframe: iframeUrl, reason: '' }
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
        for (let i = 0; i < fjClasses.length; i++) {
            const vc = new VideoClass()
            vc.type_id = fjClasses[i].id
            vc.type_name = fjClasses[i].name
            vc.hasSubclass = false
            list.push(vc)
        }
        backData.data = list
    } catch (error) {
        backData.error = '获取分类失败～' + fjErrText(error)
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
        backData.error = '获取筛选项失败～' + fjErrText(error)
    }
    return JSON.stringify(backData)
}

async function fjList(backData, tid, page) {
    const url = fjCatUrl(tid, page)
    const r = await fjGet(url, { Referer: appConfig.webSite + '/movies' })
    if (!r.ok || !r.text) {
        backData.error = '列表获取失败：' + (r.error || '接口没有返回数据')
        return
    }
    const cards = fjParseList(r.text)
    backData.data = fjListFrom(cards)
    const maxPage = fjPageCount(r.text)
    if (maxPage > 0) {
        backData.pagecount = Math.max(maxPage, page)
    }
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
        await fjList(backData, args && args.url, page)
    } catch (error) {
        backData.error = '获取列表失败～' + fjErrText(error)
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
        await fjList(backData, (args && (args.mainClassId || args.url)) || 'movies', page)
    } catch (error) {
        backData.error = '获取列表失败～' + fjErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 详情：给出全部线路（每条线路一个入口），播放时才去换地址
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoDetail())
 */
async function getVideoDetail(args) {
    var backData = new RepVideoDetail()
    try {
        const vid = fjToStr(args && args.url).replace(/^.*\/v\//, '').replace(/[\/?#].*$/, '').trim()
        if (!vid) {
            backData.error = '缺少影片编号'
            return JSON.stringify(backData)
        }
        const r = await fjGet(appConfig.webSite + '/v/' + vid, { Referer: appConfig.webSite + '/movies' })
        if (!r.ok || !r.text) {
            backData.error = '详情获取失败：' + (r.error || '接口没有返回数据')
            return JSON.stringify(backData)
        }
        const info = fjParseDetail(r.text)

        const eps = []
        const seen = {}
        for (let i = 0; i < info.eps.length; i++) {
            const pair = info.eps[i]
            if (seen[pair[1]]) {
                continue
            }
            seen[pair[1]] = 1
            const epName = info.names[i] || '线路' + (eps.length + 1)
            eps.push(epName + '$' + fjPackPlay(pair[0], pair[1], vid, info.filmId, info.pt, info.pk))
        }

        const vd = new VideoDetail()
        vd.vod_id = vid
        vd.vod_name = info.name || 'FCJAV ' + vid
        vd.vod_pic = info.pic
        vd.vod_actor = appConfig.brand
        vd.vod_director = appConfig.brand
        vd.vod_remarks = fjRemarks(info.remark || '正片')
        vd.vod_content = info.content
        vd.vod_play_from = '播放'
        vd.vod_play_url = eps.length ? eps.join('#') : '播放$' + fjPackPlay('', '', vid, info.filmId, info.pt, info.pk)
        if (!eps.length) {
            backData.error = '这部片在详情页里没有找到线路（可能已下架）'
        }
        backData.data = vd
    } catch (error) {
        backData.error = '获取详情失败～' + fjErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 播放：现走一次链路换地址；失败再回详情页重取凭据重试一轮；
 * 仍拿不到就把播放器 iframe 交出去（parse=1，让 App 自己再试解析）
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoPlayUrl())
 */
async function getVideoPlayUrl(args) {
    var backData = new RepVideoPlayUrl()
    try {
        const got = fjUnpackPlay(fjToStr(args && args.url).split('$').pop())
        if (!got.vid) {
            backData.error = '播放标识不完整'
            return JSON.stringify(backData)
        }
        let res = await fjResolve(got)
        if (!res.url) {
            // 凭据疑似一次性 —— 回详情页重取一份再来一次
            const retry = await fjResolve({
                src: '',
                eid: '',
                vid: got.vid,
                filmId: '',
                pt: '',
                pk: '',
            })
            if (retry.url) {
                res = retry
            } else if (!res.iframe && retry.iframe) {
                res = retry
            }
        }
        if (res.url) {
            return fjPlayOk(backData, res.url, appConfig.webSite + '/')
        }
        if (res.iframe) {
            backData.data = res.iframe
            backData.headers = { 'User-Agent': appConfig.ua, Referer: appConfig.webSite + '/' }
            backData.error = '没换到直链，已把播放器页面交出去：' + res.reason
            return JSON.stringify(backData)
        }
        backData.error = '获取播放地址失败：' + res.reason
    } catch (error) {
        backData.error = '获取播放地址失败～' + fjErrText(error)
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
        const kw = fjToStr(args && args.searchWord).trim()
        if (!kw) {
            return JSON.stringify(backData)
        }
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        const url =
            appConfig.webSite + '/search/' + encodeURIComponent(kw) + (page > 1 ? '/pg-' + page : '')
        const r = await fjGet(url, { Referer: appConfig.webSite + '/movies' })
        if (!r.ok || !r.text) {
            backData.error = '搜索失败：' + (r.error || '没有返回数据')
            return JSON.stringify(backData)
        }
        const cards = fjParseList(r.text)
        backData.data = fjListFrom(cards)
        if (!cards.length) {
            backData.error = '没有搜到「' + kw + '」相关内容'
        }
    } catch (error) {
        backData.error = '搜索失败～' + fjErrText(error)
    }
    return JSON.stringify(backData)
}
