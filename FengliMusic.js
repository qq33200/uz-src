// ignore
//@name:凤梨音乐
//@version:3
//@webSite:https://www.flmp3.pro
//@remark:flmp3.pro 无损音乐站。最新音乐/热门音乐/全部歌曲 三个分类 + 站内搜索；详情取歌名/歌手/封面；播放时实时向 /api/playurl.php 换真实直链（详情只存歌曲 id，不存会过期的签名地址）。主域名挂了自动切备用域名。v3：修正真机扩展报错（成对忽略标记已补齐）。
//@order: G
//@codeID:
//@env:
//@isAV:0
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
 * 凤梨音乐（flmp3.pro）
 *
 * 移植自 TVBox 的 凤梨音乐.py，保持原有链路不变：
 *   列表 /song.html?page=N 或首页两个 tab  →  详情 /song/{id}.html  →  播放 /api/playurl.php?id={id}
 * 播放接口直接返回纯文本的真实 mp3 地址（实测是酷我 CDN），所以不需要嗅探。
 *
 * 与 py 版的两处必要差异（都会在下面注明原因）：
 *   1. 二级分类必须压平。原 py 是「推荐歌单 → 最新音乐 / 热门音乐」两层，
 *      而 uz 没有「文件夹卡片」这种交互，所以直接做成两个一级分类，另加「全部歌曲」。
 *   2. 页数不能再按 py 那样用 max(页面上的 page=N) 估。实测那个页码条只是当前页 ±2
 *      的窗口（第 20 页上最大只显示 22），估出来必然偏小，会把 5 页之后的歌全砍掉。
 *      uz 翻页只认 total，这里给足常量，翻到真的没有歌那一页自然就停了。
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

//MARK: - 常量（顶层名统一加 fl 前缀：真机上同一订阅里的扩展可能共享作用域）

/** 备用域名，主域名失效时自动切换（对应 py 的 DOMAINS） */
const flDomains = ['www.flmp3.pro', 'flmp3.pro']
const flReferer = 'https://www.flmp3.pro/'
const flUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const flHeaders = {
    'User-Agent': flUa,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}
/** 探测到的可用 base，进程内缓存（对应 py 在 init 里探测一次） */
let flBaseCache = ''

//MARK: - 网络

/** 把 uz 的 req 回包统一成 {code, raw, error}；data 可能是 string / object / null，一律转文本 */
function flDataToText(p) {
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

/** 按绝对地址请求。注意这里是「不经过 base 解析」的底层请求，flProbeBase 也用它，避免递归 */
async function flFetchAbs(url, referer) {
    try {
        const p = await req(url, {
            headers: Object.assign({}, flHeaders, { Referer: referer || flReferer }),
            // py 用的是 timeout=15 秒
            sendTimeout: 15000,
            receiveTimeout: 15000,
        })
        return {
            code: p && typeof p.code === 'number' ? p.code : 0,
            raw: flDataToText(p),
            error: (p && p.error) || '',
        }
    } catch (e) {
        return { code: -1, raw: '', error: (e && e.message) || String(e) }
    }
}

/**
 * 依次探测备用域名，返回第一个可用的 base（对应 py 的 _probe_base）。
 * 都探测不通也不报错：真机上可能只是这一次探测请求被拦，直接回主域名继续试。
 */
async function flProbeBase() {
    if (flBaseCache) {
        return flBaseCache
    }
    for (let i = 0; i < flDomains.length; i++) {
        const base = 'https://' + flDomains[i]
        const r = await flFetchAbs(base + '/', flReferer)
        if (r.code === 200 && r.raw && r.raw.indexOf('凤梨') !== -1) {
            flBaseCache = base
            return base
        }
    }
    flBaseCache = 'https://' + flDomains[0]
    return flBaseCache
}

async function flGet(path, referer) {
    const p = String(path || '')
    if (/^https?:\/\//i.test(p)) {
        return await flFetchAbs(p, referer)
    }
    const base = await flProbeBase()
    return await flFetchAbs(base + p, referer)
}

//MARK: - 小工具

function flAbs(u) {
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
    const base = flBaseCache || 'https://' + flDomains[0]
    return base + (s.indexOf('/') === 0 ? s : '/' + s)
}

/**
 * 该站的图片是服务端代理出来的，上游抓取失败时会把 curl 的报错文本整个塞进 src，
 * 实测见过 src="https://img.flmp3.proCurl error: OpenSSL SSL_read: Connection reset by peer"。
 * 这种一律丢弃，别把垃圾地址交给界面。
 */
function flSafeImg(u) {
    const s = flAbs(String(u || '').trim())
    if (!/^https?:\/\/[^\s"'<>]+$/.test(s)) {
        return ''
    }
    if (s.indexOf('Curl') !== -1 || s.indexOf('Ssl') !== -1 || s.indexOf('error') !== -1) {
        return ''
    }
    return s
}

function flText(s) {
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

/** 从 uz 传回来的 args.url 里取出「最后一段」，用来认分类（可能是 id，也可能是被拼成 URL 的版本） */
function flPath(u) {
    const s = String(u || '').trim()
    if (!s) {
        return ''
    }
    let key = s.split('?')[0].split('#')[0].replace(/\/+$/, '')
    key = key.split('/').pop()
    try {
        key = decodeURIComponent(key)
    } catch (e) {
        // 解不开就用原串
    }
    return key
}

/** 取出歌曲 id。详情/播放传进来的可能是 id、/song/{id}.html 或完整 URL，所以直接挑数字串 */
function flSongId(u) {
    const m = String(u || '').match(/(\d{2,12})/)
    return m ? m[1] : ''
}

//MARK: - 列表解析

/**
 * 解析歌曲卡片。
 * 页面结构：<a href="/song/{id}.html"><div class="pic"><img src=封面 alt="歌名-歌手"></div>
 *           <div class="con"><div class="t"><h3>歌名</h3><p>歌手</p></div><div class="date">日期</div></div></a>
 * 原 py 是「命中 href 后往后截 500 字符」的窗口式解析，卡片一长就会串到下一张，
 * 这里改成直接把整个 <a>…</a> 抓下来，更稳且行为等价。
 */
function flParseCards(html) {
    const out = []
    if (!html) {
        return out
    }
    const seen = {}
    const re = /<a[^>]+href="\/song\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/gi
    let m
    while ((m = re.exec(html)) !== null) {
        const sid = m[1]
        if (seen[sid]) {
            continue
        }
        seen[sid] = 1
        const block = m[2]
        const mName = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
        let name = mName ? flText(mName[1]) : ''
        if (!name) {
            // 兜底：封面 alt 一般是「歌名-歌手」
            const mAlt = block.match(/alt="([^"]*)"/i)
            if (mAlt) {
                name = flText(mAlt[1]).split('-')[0]
            }
        }
        if (!name) {
            name = '歌曲' + sid
        }
        const mSinger = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
        const mImg = block.match(/<img[^>]+src="([^"]+)"/i)

        let v = new VideoDetail()
        v.vod_id = sid
        v.vod_name = name
        v.vod_pic = mImg ? flSafeImg(mImg[1]) : ''
        v.vod_remarks = mSinger ? flText(mSinger[1]) : ''
        out.push(v)
    }
    return out
}

/**
 * 首页 tab 面板切分（对应 py 的 _home_songs）。
 * 结构：<div class="list"><div class="item on"><ul>…最新音乐…</ul></div><div class="item"><ul>…热门音乐…</ul></div></div>
 * 实测第一个面板带 on（最新音乐），第二个是热门音乐。
 */
function flHomePanel(html, which) {
    if (!html) {
        return ''
    }
    const i = html.indexOf('class="list"')
    if (i < 0) {
        return ''
    }
    const seg = html.slice(i)
    const parts = seg.split('<div class="item')
    if (which === 'new') {
        return parts.length > 1 ? parts[1] : seg
    }
    // 热门：面板 2 之后的所有内容（含页脚，页脚里没有 /song/ 链接，不影响）
    return parts.length > 2 ? parts.slice(2).join('\n<div class="item') : seg
}

//MARK: - 详情 / 播放

async function flAllSongs(page) {
    const r = await flGet('/song.html?page=' + page)
    if (r.code !== 200 || !r.raw) {
        return {
            data: [],
            total: 0,
            error: '列表请求失败：HTTP ' + r.code + (r.error ? '（' + r.error + '）' : ''),
        }
    }
    const list = flParseCards(r.raw)
    // total 见文件头注释第 2 条：不能按 py 的 max() 估
    return { data: list, total: list.length ? 9999 : 0, error: '' }
}

async function flSongMeta(sid) {
    const out = { name: '歌曲' + sid, singer: '', pic: '', code: 0, error: '', ok: false }
    const r = await flGet('/song/' + sid + '.html')
    out.code = r.code
    out.error = r.error
    if (r.code !== 200 || !r.raw) {
        return out
    }
    out.ok = true
    const h = r.raw
    const m1 = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (m1) {
        const t = flText(m1[1])
        if (t) {
            out.name = t
        }
    }
    const m2 = h.match(/歌手：\s*<a[^>]*>([\s\S]*?)<\/a>/i)
    if (m2) {
        out.singer = flText(m2[1])
    }
    // py 用的是全文第一张 <img>，实测那可能落到页头；优先取详情主图
    let m3 = h.match(/<div class="pic">\s*<img[^>]+src="([^"]+)"/i)
    if (!m3) {
        m3 = h.match(/<img[^>]+src="([^"]+)"[^>]*alt="/i)
    }
    if (m3) {
        out.pic = flSafeImg(m3[1])
    }
    return out
}

/**
 * GET /api/playurl.php?id=xx —— 站点直接吐纯文本真实地址。
 * 返回 {url, code, error}：code 用来区分「网络/接口失败」和「站点明说这首歌没资源」，
 * 这两种情况的提示语不一样，不能混成一句。
 */
async function flPlayUrlInfo(sid) {
    const out = { url: '', code: 0, error: '' }
    const base = await flProbeBase()
    const r = await flFetchAbs(
        base + '/api/playurl.php?id=' + encodeURIComponent(sid),
        base + '/song/' + sid + '.html'
    )
    out.code = r.code
    out.error = r.error
    if (r.code !== 200) {
        return out
    }
    const t = String(r.raw || '').trim()
    if (/^https?:\/\/\S+$/i.test(t)) {
        out.url = t
        return out
    }
    // 保险：万一站点改成回 JSON
    try {
        const j = JSON.parse(t)
        const cand = (j && (j.url || j.data || j.playUrl || j.src)) || ''
        if (typeof cand === 'string' && /^https?:\/\//i.test(cand)) {
            out.url = cand
        }
    } catch (e) {
        // 不是 JSON，正常
    }
    return out
}

async function flPlayUrl(sid) {
    const info = await flPlayUrlInfo(sid)
    return info.url
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
        const raw = [
            ['new', '🔥 最新音乐'],
            ['hot', '🎵 热门音乐'],
            ['all', '🎧 全部歌曲'],
        ]
        const list = []
        for (let i = 0; i < raw.length; i++) {
            let vc = new VideoClass()
            vc.type_id = raw[i][0]
            vc.type_name = raw[i][1]
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
        const gid = flPath(args && args.url)
        const page = args && args.page && args.page > 0 ? parseInt(args.page, 10) : 1

        if (gid === 'new' || gid === 'hot') {
            // 首页两个 tab，只有第 1 页
            const r = await flGet('/')
            if (r.code !== 200 || !r.raw) {
                backData.error = '首页请求失败：HTTP ' + r.code + (r.error ? '（' + r.error + '）' : '')
                return JSON.stringify(backData)
            }
            const list = flParseCards(flHomePanel(r.raw, gid === 'new' ? 'new' : 'hot'))
            if (list.length) {
                backData.data = list
                backData.total = list.length
                return JSON.stringify(backData)
            }
            // 首页结构变了也不能让分类空白 —— 退回全部歌曲并说明
            const fb = await flAllSongs(1)
            backData.data = fb.data
            backData.total = fb.data.length
            backData.error =
                '首页「' + (gid === 'new' ? '最新音乐' : '热门音乐') + '」面板没解析出歌曲，已自动改用「全部歌曲」'
            return JSON.stringify(backData)
        }

        const r2 = await flAllSongs(page)
        backData.data = r2.data
        backData.total = r2.total
        backData.error = r2.error
        if (page > 1 && !r2.data.length) {
            backData.error = '第 ' + page + ' 页已经没有歌曲了（该站只收录到这里）'
        }
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
        const sid = flSongId(args && args.url)
        if (!sid) {
            backData.error = '无效的歌曲 ID：' + JSON.stringify(String((args && args.url) || ''))
            return JSON.stringify(backData)
        }
        const meta = await flSongMeta(sid)
        const pi = await flPlayUrlInfo(sid)
        const playable = !!pi.url

        let d = new VideoDetail()
        d.vod_id = sid
        d.vod_name = meta.name
        d.vod_pic = meta.pic
        d.vod_actor = meta.singer
        d.vod_remarks = playable ? '可试听' : '暂无直链'
        d.vod_content =
            '歌手：' +
            (meta.singer || '未知') +
            (playable
                ? '\n（播放时实时向站点换取直链，所以不受签名过期影响）'
                : '\n（站点没有返回这首歌的播放直链，可能已下架）')
        d.vod_play_from = 'MP3'
        // 存歌曲 id 而不是真实 URL —— 直链带签名会过期（沿用 py 的做法）
        d.vod_play_url = (playable ? 'MP3' : '暂无资源') + '$' + sid
        backData.data = d

        // 失败不能静默：详情页没拿到 / 播放接口报错，都要说出来。
        // 但仍把 data 返回上去，这样界面至少还能显示歌名，而不是一片空白。
        if (!meta.ok || pi.code !== 200) {
            const parts = []
            if (!meta.ok) {
                parts.push('详情页请求失败：HTTP ' + meta.code + (meta.error ? '（' + meta.error + '）' : ''))
            }
            if (pi.code !== 200) {
                parts.push('播放接口请求失败：HTTP ' + pi.code + (pi.error ? '（' + pi.error + '）' : ''))
            }
            backData.error = parts.join('；')
        }
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
        const base = await flProbeBase()
        let u = String((args && args.url) || '').trim()
        // 兼容三种传法：真实直链 / "MP3$203655" / 光秃秃的 id
        if (!/^https?:\/\//i.test(u)) {
            const dollar = u.indexOf('$')
            if (dollar !== -1) {
                u = u.slice(dollar + 1).trim()
            }
        }
        if (/^https?:\/\//i.test(u)) {
            backData.data = u
            backData.headers = { 'User-Agent': flUa, Referer: base + '/' }
            return JSON.stringify(backData)
        }
        const sid = flSongId(u)
        if (!sid) {
            backData.error = '无效的歌曲 ID：' + JSON.stringify(u)
            return JSON.stringify(backData)
        }
        const pi = await flPlayUrlInfo(sid)
        if (!pi.url) {
            backData.error =
                pi.code !== 200
                    ? '播放接口请求失败：HTTP ' + pi.code + (pi.error ? '（' + pi.error + '）' : '')
                    : '站点返回了 200 但没给出直链（可能已下架或接口有变）'
            return JSON.stringify(backData)
        }
        backData.data = pi.url
        backData.headers = { 'User-Agent': flUa, Referer: base + '/song/' + sid + '.html' }
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
        const r = await flGet('/search.html?keyword=' + encodeURIComponent(kw))
        if (r.code !== 200 || !r.raw) {
            backData.error = '搜索请求失败：HTTP ' + r.code + (r.error ? '（' + r.error + '）' : '')
            return JSON.stringify(backData)
        }
        const list = flParseCards(r.raw)
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
