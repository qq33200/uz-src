// ignore
//@name:MoboReels 畅读热剧
//@version:1
//@webSite:https://www.moboreels.com/cn/
//@remark:竖屏短剧站（Nuxt SSR）。30 个题材分类 + 站内搜索；剧集数据内联在页面的 window.__NUXT__ 里，直接求值取用。⚠️ 详情/播放链路未能在开发机上验证：本机（Node/curl）请求详情页会被站点 WAF 降级成不含剧集数据的精简版，分类页/搜索页则正常（已实测）。真机是 Flutter 原生请求栈，通常能拿到完整版；若详情页报错，请把提示原文反馈。
//@order: H
//@codeID:
//@env:
//@isAV:0
//@deprecated:0

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

import {
    UZUtils,
    ProData,
    ReqResponseType,
    ReqAddressType,
    req,
    getEnv,
    setEnv,
    goToVerify,
    openWebToBindEnv,
    toast,
    kIsDesktop,
    kIsAndroid,
    kIsIOS,
    kIsWindows,
    kIsMacOS,
    kIsTV,
    kLocale,
    kAppVersion,
    formatBackData,
} from '../../core/uzUtils.js'

import { cheerio, Crypto, Encrypt, JSONbig } from '../../core/uz3lib.js'
// ignore

/**
 * MoboReels 畅读热剧（www.moboreels.com）
 *
 * 移植自 TVBox 的 MoboReels畅读热剧.py。
 *
 * 这个站是 Nuxt SSR：页面里内联了一段被压缩过的 `window.__NUXT__ = (function(a,b){…}(…))`，
 * 剧集数据都在这段 payload 里。原 py 用了约 150 行手写解析（拆形参、拆实参、做变量替换），
 * 其实整段是个自包含的 JS —— 在 JS 环境里直接求值就行，所以这里把那 150 行整个省掉了，
 * 逻辑上等价（`mbEvalNuxt`）。
 *
 * 页面里能拿到的东西（已在本机对分类页/搜索页实测）：
 *   payload 的 data[0] = { series:{seriesName, coverUrl, allEpis, description, types[]},
 *                          detail:{episNum, mediaUrl, resolvedMediaUrl, isFree, isLock},
 *                          list:[{episId, episNum, isFree, isLock, coverUrl, mediaUrl}, …] }
 *   免费集的 list[i].mediaUrl 本身就是 https://cdnvideo.cdreader.com/…mp4 直链，
 *   锁定集没有 mediaUrl。所以详情页可以直接把免费集的直链写进选集，点开即可播；
 *   没有直链的集才需要回剧集页取 resolvedMediaUrl。
 *
 * ⚠️ 未验证的部分：详情页 / 剧集页。本机对同一 URL、同一时刻做过对比：
 *   curl → 136 KB 完整版（含 series/episNum），node → 65 KB 精简版（被重定向到英文首页，零剧集数据）。
 *   换请求头、Accept-Language、GET/POST、HTTP/1.1 全都无效，属客户端指纹级识别；
 *   H5 API（videoapi-hk.cdreader.com）也被腾讯 EdgeOne WAF 拦（HTTP 567）。
 *   分类页与搜索页 node 能拿到完整版，所以只有详情/播放这一段是「未在本机验证」的。
 *   真机走原生网络栈，大概率能拿到 curl 那种完整版。若详情页出错，代码会把原因原文带出来。
 */

const appConfig = {
    _webSite: '',
    /**
     * 网站主页，uz 调用每个函数前都会进行赋值操作
     * 如果不想被改变 请自定义一个变量
     */
    get webSite() {
        return this._webSite
    },
    set webSite(value) {
        this._webSite = value
    },

    _uzTag: '',
    /**
     * 扩展标识，初次加载时，uz 会自动赋值，请勿修改
     * 用于读取环境变量
     */
    get uzTag() {
        return this._uzTag
    },
    set uzTag(value) {
        this._uzTag = value
    },
}

//MARK: - 常量（顶层名统一加 mb 前缀：真机上同一订阅里的扩展可能共享作用域）

const mbHost = 'https://www.moboreels.com'
const mbLang = 'cn'
const mbUa =
    'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const mbHeaders = {
    'User-Agent': mbUa,
    Referer: mbHost + '/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

/** 30 个题材分类，与原 py 完全一致 */
const mbClasses = [
    '逆袭',
    '现代言情',
    '总裁',
    '反击',
    '都市生活',
    '复仇',
    '穿越重生',
    '逆袭反转',
    '豪门恩怨',
    '甜宠',
    '现代都市',
    '隐藏身份',
    '王妃',
    '战神',
    '宫斗',
    '东方玄幻',
    '重生',
    '虐恋',
    '家庭亲情',
    '系统',
    '乡村',
    '神医',
    '大女主',
    '萌宝',
    '断亲',
    '打脸',
    '古装权谋',
    '闪婚',
    '先婚后爱',
    '轻喜剧',
]

const mbNoteUnverified =
    '\n[未验证] 本源的详情/播放链路没能在开发机上验证（站点 WAF 会把非浏览器的详情页请求降级成不含剧集数据的版本）。\n如果这一页能列出剧集、能播，说明真机没问题；如果报错，请把提示原文反馈给我。'

//MARK: - 网络

function mbDataToText(p) {
    if (!p) {
        return ''
    }
    const d = p.data
    if (typeof d === 'string') {
        return d
    }
    if (d === null || d === undefined) {
        return ''
    }
    try {
        return JSON.stringify(d)
    } catch (e) {
        return ''
    }
}

async function mbGet(url) {
    try {
        const p = await req(url, {
            headers: mbHeaders,
            sendTimeout: 25000,
            receiveTimeout: 25000,
        })
        return {
            code: p && typeof p.code === 'number' ? p.code : 0,
            raw: mbDataToText(p),
            error: (p && p.error) || '',
        }
    } catch (e) {
        return { code: -1, raw: '', error: (e && e.message) || String(e) }
    }
}

//MARK: - 小工具

function mbAbs(u) {
    const s = String(u || '').trim()
    if (!s) {
        return ''
    }
    if (/^https?:\/\//i.test(s)) {
        return s
    }
    if (s.indexOf('//') === 0) {
        return 'https:' + s
    }
    return mbHost + (s.indexOf('/') === 0 ? s : '/' + s)
}

function mbText(s) {
    return String(s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

function mbIsMedia(u) {
    return /\.(mp4|m4v|m3u8|ts|mpd)(\?|#|$)/i.test(String(u || ''))
}

/** 从 /drama/{标题编码}-{seriesId} 里拆出标题段和 seriesId（原 py 的 mslug 逻辑） */
function mbSplitSlug(raw) {
    let slug = String(raw || '').split('/drama/').pop() || ''
    slug = slug.split('?')[0].split('#')[0]
    const m = slug.match(/^(.*)-(\d+)$/)
    if (m) {
        return { titleEnc: m[1], sid: m[2] }
    }
    return { titleEnc: slug.replace(/-\d+$/, ''), sid: '' }
}

function mbSlugTitle(raw) {
    const s = mbSplitSlug(raw)
    let t = s.titleEnc
    try {
        t = decodeURIComponent(t)
    } catch (e) {
        // 解不开就用原串
    }
    return t.replace(/-/g, ' ').trim()
}

/** 剧集页路径。原 py 用 "%02d" 补到 2 位，这里保持一致 */
function mbEpPath(titleEnc, sid, num) {
    if (!titleEnc || !sid || num === null || num === undefined || num === '') {
        return ''
    }
    const s = String(num)
    const nn = s.length < 2 ? '0' + s : s
    return '/episode/' + titleEnc + '-' + sid + '-' + nn
}

function mbDomTitle(html) {
    const m = String(html || '').match(/<title>([^<]+)<\/title>/i)
    if (!m) {
        return ''
    }
    // 原 py：re.sub(r"短剧.*$", "", title)
    return mbText(m[1]).replace(/短剧.*$/, '').trim()
}

/** 站点被降级/请求首页时会返回这种通用标题，不能当剧名用（实测：MoboReels - Free Short Dramas…） */
function mbIsGenericTitle(t) {
    const s = String(t || '').toLowerCase()
    return (
        !s ||
        s.indexOf('moboreels') !== -1 ||
        s.indexOf('free short dramas') !== -1 ||
        s.indexOf('watch online') !== -1
    )
}

/**
 * 剧名优先级：页面 <title>（去掉「短剧…」后缀）→ URL slug 里的名字。
 * 降级页的 <title> 是站点通用标题，这时改用 slug（例如 /drama/至尊白帝-10060449 → 至尊白帝），
 * 比给用户看一串英文站名有用得多。
 */
function mbBestTitle(html, raw) {
    const t = mbDomTitle(html)
    if (t && !mbIsGenericTitle(t)) {
        return t
    }
    const s = mbSlugTitle(raw)
    if (s) {
        return s
    }
    return t || '短剧'
}

function mbDomPic(html) {
    const h = String(html || '')
    const m = h.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    if (m && /^https?:\/\//i.test(m[1])) {
        return mbAbs(m[1])
    }
    // 实测第一个 <img> 往往是 /_nuxt/img/loading.*.gif 这种占位图，必须跳过，
    // 否则封面会变成一张 loading 图
    const all = h.match(/<img[^>]+(?:data-src|src)="([^"]+)"/gi) || []
    for (let i = 0; i < all.length; i++) {
        const mm = all[i].match(/(?:data-src|src)="([^"]+)"/i)
        if (!mm) {
            continue
        }
        const u = mm[1]
        const low = u.toLowerCase()
        if (low.indexOf('/_nuxt/') !== -1 || low.indexOf('loading') !== -1 || low.indexOf('.gif') !== -1) {
            continue
        }
        return mbAbs(u.replace(/\?imageMogr2.*$/, ''))
    }
    return ''
}

//MARK: - 列表解析（对应 py 的 _parse_cards）

function mbParseCards(html) {
    const out = []
    if (!html) {
        return out
    }
    const seen = {}
    const patterns = [
        /<a[^>]+href="(\/drama\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        /<a[^>]+href="(\/drama\/[^"]+)"[^>]*>/gi,
    ]
    for (let pi = 0; pi < patterns.length; pi++) {
        const re = patterns[pi]
        let m
        while ((m = re.exec(html)) !== null) {
            const href = m[1]
            if (seen[href]) {
                continue
            }
            seen[href] = 1
            const block = m[2] || ''

            let title = ''
            const mAlt = block.match(/alt="([^"]+)"/i)
            if (mAlt) {
                title = mbText(mAlt[1])
            }
            if (!title) {
                const mT = block.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i)
                if (mT) {
                    title = mbText(mT[1])
                }
            }
            if (!title) {
                // 兜底：从 slug 反推（原 py 的做法）
                title = mbSlugTitle(href)
            }
            if (!title) {
                continue
            }

            let pic = ''
            const mP = block.match(/(?:data-src|src)="([^"]+)"/i)
            if (mP) {
                pic = mbAbs(mP[1].trim().replace(/\?imageMogr2.*$/, ''))
            }

            let v = new VideoDetail()
            v.vod_id = href
            v.vod_name = title
            v.vod_pic = pic
            v.vod_remarks = ''
            out.push(v)
        }
        if (out.length) {
            break
        }
    }
    return out
}

//MARK: - Nuxt payload 求值（取代 py 那 150 行手写解析）

/**
 * 求值 window.__NUXT__，返回 payload 对象；失败返回 null。
 *
 * 这样能同时吃两种形态：
 *   window.__NUXT__=(function(a,b){return {…}}(1,2))     ← 自包含 IIFE
 *   window.__NUXT__={…};window.__NUXT__.config={…}       ← 多语句
 * 做法就是把这一整段代码丢进 new Function，配一个假的 window，再读回来。
 */
function mbEvalNuxt(html) {
    const h = String(html || '')
    const i = h.indexOf('window.__NUXT__=')
    if (i < 0) {
        return null
    }
    let j = h.indexOf('</script', i)
    if (j < 0) {
        j = h.length
    }
    const code = h.slice(i, j).trim()
    if (!code) {
        return null
    }
    try {
        const fakeWindow = {}
        const fn = new Function('window', code + '\n;return window.__NUXT__')
        const v = fn(fakeWindow)
        if (v && typeof v === 'object') {
            return v
        }
        if (fakeWindow.__NUXT__ && typeof fakeWindow.__NUXT__ === 'object') {
            return fakeWindow.__NUXT__
        }
        return null
    } catch (e) {
        return null
    }
}

/**
 * 在 payload 里广度优先找「带 series 的那个节点」。
 * 不写死 data[0]，这样 Nuxt 版本变了、层级挪了也还能找到。
 */
function mbFindSeriesNode(root) {
    if (!root || typeof root !== 'object') {
        return null
    }
    const seen = new Set()
    const queue = [root]
    let guard = 0
    while (queue.length && guard < 30000) {
        guard++
        const o = queue.shift()
        if (!o || typeof o !== 'object' || seen.has(o)) {
            continue
        }
        seen.add(o)
        const s = o.series
        if (s && typeof s === 'object' && (s.seriesName || s.seriesId)) {
            return o
        }
        for (const k in o) {
            const v = o[k]
            if (v && typeof v === 'object') {
                queue.push(v)
            }
        }
    }
    return null
}

/** 从页面里尽力抠出一个媒体直链（先走 payload，再就地正则） */
function mbExtractMedia(html) {
    const h = String(html || '')
    if (!h) {
        return ''
    }
    const payload = mbEvalNuxt(h)
    if (payload) {
        const node = mbFindSeriesNode(payload)
        const d = node && node.detail
        if (d && typeof d === 'object') {
            const cand = d.resolvedMediaUrl || d.mediaUrl || ''
            if (typeof cand === 'string' && /^https?:\/\//i.test(cand)) {
                return cand
            }
        }
        // detail 可能不在同一个节点上，全局再找一遍
        const alt = mbFindMediaDeep(payload)
        if (alt) {
            return alt
        }
    }
    // payload 里取不到时，就地正则。注意站点把 URL 里的 / 写成了 \u002F（实测），
    // 所以要先反转义再找，否则一条都匹配不到。
    const un = h.replace(/\\u002F/g, '/').replace(/\\\//g, '/')
    const pats = [
        /"(?:resolvedMediaUrl|mediaUrl)"\s*:\s*"([^"]+)"/i,
        /(https?:\/\/[^"'\s<>\\]+\.(?:mp4|m3u8|ts)[^"'\s<>\\]*)/i,
    ]
    for (let i = 0; i < pats.length; i++) {
        const m = un.match(pats[i])
        if (m) {
            const u = (m[1] || '').replace(/\\u002F/g, '/').replace(/\\\//g, '/')
            if (/^https?:\/\//i.test(u)) {
                return u
            }
        }
    }
    return ''
}

/** 在 payload 里找任意一个 resolvedMediaUrl / mediaUrl */
function mbFindMediaDeep(root) {
    if (!root || typeof root !== 'object') {
        return ''
    }
    const seen = new Set()
    const queue = [root]
    let guard = 0
    while (queue.length && guard < 30000) {
        guard++
        const o = queue.shift()
        if (!o || typeof o !== 'object' || seen.has(o)) {
            continue
        }
        seen.add(o)
        const cand = o.resolvedMediaUrl || o.mediaUrl
        if (typeof cand === 'string' && /^https?:\/\//i.test(cand)) {
            return cand
        }
        for (const k in o) {
            const v = o[k]
            if (v && typeof v === 'object') {
                queue.push(v)
            }
        }
    }
    return ''
}

//MARK: - 分类识别

/** uz 可能把 type_id 原样传回，也可能拼成 URL，所以按「整体」和「最后一段」各认一次 */
function mbTagOf(u) {
    const s = String(u || '').trim()
    if (!s) {
        return ''
    }
    for (let i = 0; i < mbClasses.length; i++) {
        if (mbClasses[i] === s) {
            return mbClasses[i]
        }
    }
    let key = s.split('?')[0].split('#')[0].replace(/\/+$/, '')
    key = key.split('/').pop()
    try {
        key = decodeURIComponent(key)
    } catch (e) {
        // 解不开就用原串
    }
    for (let i = 0; i < mbClasses.length; i++) {
        if (mbClasses[i] === key) {
            return mbClasses[i]
        }
    }
    // 认不出来也照原样试一次，宁可请求一次也不要把分类变成空的
    return key
}

//MARK: - 对外接口

/**
 * 分类列表
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoClassList())
 */
async function getClassList(args) {
    var backData = new RepVideoClassList()
    try {
        const list = []
        for (let i = 0; i < mbClasses.length; i++) {
            let vc = new VideoClass()
            vc.type_id = mbClasses[i]
            vc.type_name = mbClasses[i]
            vc.hasSubclass = false
            list.push(vc)
        }
        backData.data = list
    } catch (error) {
        backData.error = '获取分类失败～' + (error && error.message ? error.message : error)
    }
    return JSON.stringify(backData)
}

/**
 * 二级分类 / 筛选列表（本源没有，hasSubclass 全为 false，uz 不会调到这里）
 */
async function getSubclassList(args) {
    var backData = new RepVideoSubclassList()
    try {
        backData.data = new VideoSubclass()
    } catch (error) {
        backData.error = '获取筛选项失败～' + (error && error.message ? error.message : error)
    }
    return JSON.stringify(backData)
}

/**
 * 分类视频列表
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function getVideoList(args) {
    var backData = new RepVideoList()
    try {
        const tag = mbTagOf(args && args.url)
        const page = args && args.page && args.page > 0 ? parseInt(args.page, 10) : 1
        if (!tag) {
            backData.error = '没有这个分类'
            return JSON.stringify(backData)
        }
        const enc = encodeURIComponent(tag)
        const url =
            page <= 1
                ? mbHost + '/' + mbLang + '/dramas/' + enc
                : mbHost + '/' + mbLang + '/dramas/' + enc + '/page/' + page
        const r = await mbGet(url)
        if (r.code !== 200 || !r.raw) {
            backData.error = '列表请求失败：HTTP ' + r.code + (r.error ? '（' + r.error + '）' : '') + ' —— ' + url
            return JSON.stringify(backData)
        }
        const list = mbParseCards(r.raw)
        if (!list.length) {
            backData.total = 0
            backData.error =
                '第 ' +
                page +
                ' 页没解析到短剧（HTTP ' +
                r.code +
                '，收到 ' +
                r.raw.length +
                ' 字节）。可能是站点改版，或该分类没有第 ' +
                page +
                ' 页'
            return JSON.stringify(backData)
        }
        backData.data = list
        // 原 py：先假定还有下一页，再用页面上的 "N / M" 覆盖
        let pagecount = page + 1
        const m = r.raw.match(/(\d+)\s*\/\s*(\d+)/)
        if (m) {
            const mc = parseInt(m[2], 10)
            if (mc > 0) {
                pagecount = mc
            }
        }
        backData.total = pagecount * 30
    } catch (error) {
        backData.error = '获取列表失败～' + (error && error.message ? error.message : error)
    }
    return JSON.stringify(backData)
}

/**
 * 二级分类 / 筛选视频列表（同 getVideoList）
 */
async function getSubclassVideoList(args) {
    var backData = new RepVideoList()
    try {
        return await getVideoList({ url: (args && args.mainClassId) || (args && args.url), page: args && args.page })
    } catch (error) {
        backData.error = '获取列表失败～' + (error && error.message ? error.message : error)
    }
    return JSON.stringify(backData)
}

/**
 * 视频详情
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoDetail())
 */
async function getVideoDetail(args) {
    var backData = new RepVideoDetail()
    try {
        const raw = String((args && args.url) || '').trim()
        if (!raw) {
            backData.error = '详情入参为空'
            return JSON.stringify(backData)
        }
        const url = mbAbs(raw)
        const r = await mbGet(url)
        if (r.code !== 200 || !r.raw) {
            backData.error = '详情页请求失败：HTTP ' + r.code + (r.error ? '（' + r.error + '）' : '') + ' —— ' + url
            return JSON.stringify(backData)
        }

        const payload = mbEvalNuxt(r.raw)
        const node = payload ? mbFindSeriesNode(payload) : null

        if (!node) {
            // 兜底：DOM 里只有标题/封面，剧集列表拿不到。把原因原文带出来，别静默空列表。
            let d = new VideoDetail()
            d.vod_id = raw
            d.vod_name = mbBestTitle(r.raw, raw)
            d.vod_pic = mbDomPic(r.raw)
            d.vod_remarks = '剧集未解析'
            d.vod_play_from = '畅读热剧'
            d.vod_play_url = '尝试播放$' + url
            d.vod_content =
                '【没解析出剧集列表】页面里找不到 window.__NUXT__ 的剧集数据（收到 ' +
                r.raw.length +
                ' 字节）。' +
                mbNoteUnverified
            backData.data = d
            backData.error =
                '剧集数据解析失败：页面里没有 window.__NUXT__ 的 series/list（收到 ' +
                r.raw.length +
                ' 字节，疑似被站点 WAF 降级成精简页）'
            return JSON.stringify(backData)
        }

        const series = node.series || {}
        const detail = node.detail && typeof node.detail === 'object' ? node.detail : {}
        const eps = Array.isArray(node.list) ? node.list : []

        let name = series.seriesName || ''
        if (!name) {
            name = mbBestTitle(r.raw, raw)
        }
        const cover = series.coverUrl ? mbAbs(series.coverUrl) : ''
        const desc = typeof series.description === 'string' ? series.description : ''
        let total = series.allEpis || eps.length
        const types = Array.isArray(series.types) ? series.types.join(' / ') : ''

        const sp = mbSplitSlug(raw)
        const titleEnc = sp.titleEnc
        const sid = sp.sid || String(series.seriesId || '')

        // 选集：免费集直接把直链写进去（点开即播）；没有直链的集留剧集页路径，播放时再取
        const parts = []
        let inline = 0
        let skipped = 0
        for (let i = 0; i < eps.length; i++) {
            const e = eps[i] || {}
            const num = parseInt(e.episNum, 10)
            if (isNaN(num)) {
                continue
            }
            const mu = typeof e.mediaUrl === 'string' ? e.mediaUrl : ''
            // uz 用 # 分集、$ 分名称与地址；地址里带这两个字符就没法内联，退回剧集页
            if (/^https?:\/\//i.test(mu) && mu.indexOf('#') === -1 && mu.indexOf('$') === -1) {
                parts.push('第' + num + '集$' + mu)
                inline++
            } else {
                const p = mbEpPath(titleEnc, sid, num)
                if (p) {
                    parts.push('第' + num + '集$' + p)
                } else {
                    skipped++
                }
            }
        }

        if (!parts.length) {
            let d0 = new VideoDetail()
            d0.vod_id = raw
            d0.vod_name = name
            d0.vod_pic = cover
            d0.vod_remarks = '剧集列表为空'
            d0.vod_play_from = '畅读热剧'
            d0.vod_play_url = '尝试播放$' + url
            d0.vod_content = '【剧集列表是空的】' + mbNoteUnverified
            backData.data = d0
            backData.error = '解析出了 series，但 list 里没有可用剧集（' + eps.length + ' 项）'
            return JSON.stringify(backData)
        }

        let d = new VideoDetail()
        d.vod_id = raw
        d.vod_name = name
        d.vod_pic = cover
        d.type_name = types
        d.vod_remarks =
            '共' + total + '集' + (inline ? '（' + inline + ' 集可直连）' : '') + (skipped ? '／' + skipped + ' 集缺地址' : '')
        d.vod_content =
            (desc ? desc + '\n' : '') +
            '题材：' +
            (types || '未知') +
            '\n共 ' +
            total +
            ' 集，其中 ' +
            inline +
            ' 集带直链' +
            (detail.episNum !== undefined && detail.episNum !== null ? '（详情页默认第 ' + detail.episNum + ' 集）' : '') +
            mbNoteUnverified
        d.vod_play_from = '畅读热剧'
        d.vod_play_url = parts.join('#')
        backData.data = d
    } catch (error) {
        backData.error = '获取详情失败～' + (error && error.message ? error.message : error)
    }
    return JSON.stringify(backData)
}

/**
 * 视频播放地址
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoPlayUrl())
 */
async function getVideoPlayUrl(args) {
    var backData = new RepVideoPlayUrl()
    try {
        const raw = String((args && args.url) || '').trim()
        if (!raw) {
            backData.error = '播放入参为空'
            return JSON.stringify(backData)
        }
        const url = mbAbs(raw)
        const headers = { 'User-Agent': mbUa, Referer: mbHost + '/' }

        // 详情页已经把免费集的直链内联进来了，直接用
        if (mbIsMedia(url)) {
            backData.data = url
            backData.headers = headers
            return JSON.stringify(backData)
        }

        // 剧集页 / 详情页：去页面里掏直链
        const r = await mbGet(url)
        if (r.code === 200 && r.raw) {
            const media = mbExtractMedia(r.raw)
            if (media) {
                backData.data = media
                backData.headers = headers
                return JSON.stringify(backData)
            }
        }

        // 拿不到直链 —— 交给 uz 官方的嗅探兜底，并把原因说清楚（不静默）
        backData.data = ''
        backData.headers = headers
        backData.sniffer = { url: url, ua: mbUa, timeOut: 30, retry: 2 }
        backData.error =
            '没能从页面里直接解析出直链（HTTP ' +
            r.code +
            (r.error ? '：' + r.error : '，收到 ' + r.raw.length + ' 字节') +
            '），已交给嗅探器尝试。本条属于「未在本机验证」的链路，若一直失败请反馈。'
    } catch (error) {
        backData.error = '获取播放地址失败～' + (error && error.message ? error.message : error)
    }
    return JSON.stringify(backData)
}

/**
 * 搜索视频
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function searchVideo(args) {
    var backData = new RepVideoList()
    try {
        const kw = String((args && args.searchWord) || '').trim()
        if (!kw) {
            return JSON.stringify(backData)
        }
        const url = mbHost + '/' + mbLang + '/search/' + encodeURIComponent(kw)
        const r = await mbGet(url)
        if (r.code !== 200 || !r.raw) {
            backData.error = '搜索请求失败：HTTP ' + r.code + (r.error ? '（' + r.error + '）' : '') + ' —— ' + url
            return JSON.stringify(backData)
        }
        const list = mbParseCards(r.raw)
        backData.data = list
        backData.total = list.length
        if (!list.length) {
            backData.error = '没搜到「' + kw + '」'
        }
    } catch (error) {
        backData.error = '搜索失败～' + (error && error.message ? error.message : error)
    }
    return JSON.stringify(backData)
}
