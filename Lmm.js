// ignore
//@name:路漫漫动漫
//@webSite:https://www.lmm85.com
//@version:1
//@remark:路漫漫动漫（lmm85）TVBox py 源移植。8 个分类 + 年份/排序筛选 + 站内搜索；详情 2~4 条线路；播放走云播解析器现取直链（vod_play_url 只存标识，不存会过期的签名地址）。已剔除广告线路（adkwai 一族解析出来的是真广告片）与解析器已停用的两条线路（migu/wxv）。接口双域名自动切换。v1。
//@order: I
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
 * 路漫漫动漫（lmm85）—— TVBox py 源 → uz 视频源扩展
 *
 * 原链路（照抄，不新增探测请求）：
 *   分类   /api.php/Appapi/vod?pg=1&limit=1      → class[]
 *   列表   /api.php/Appapi/vod?t=&pg=&limit=&year=&by=
 *   搜索   /api.php/Appapi/vod?wd=&pg=&limit=
 *   详情   /api.php/Appapi/vod?ids=
 *   播放   详情里 vod_play_url 只存标识 play|vid|线路序号|集序号
 *          → 播放时重新取详情 → 拿到该集的 enc → 交给云播解析器 yun.92cj.com 换直链
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 与 py 原版的差异（每一处都写了原因，其余逻辑一行未动）
 *
 * 1. 【播放头绝不能带 Referer】（最关键的一条，实测）
 *    groupvideo.photo.qq.com 对**带 Referer 的请求返回 404 / 0 字节**，
 *    对不带 Referer 的请求返回 206 + video/mp4（文件 500MB~660MB 真片源）。
 *    同一条地址、同一秒、交替 5 轮 × 4 条地址，结论稳定；解析器响应里也明写
 *    `"referer":"never"`。原版 playerContent 给的 header 正好只有 User-Agent，
 *    所以原版是好的 —— 这里**保持不加 Referer**（这是最容易"顺手加错"的地方）。
 *
 * 2. 【剔除广告线路】adkwai 一族的地址实测**能播**，但播的是广告片
 *    （v1.adkwai.com 返回 206 + 真 mp4）。原版已有这个过滤，保留。
 *
 * 3. 【剔除解析器已停用的线路】migu云播（纯数字 enc）与 wxv云播（xv2023_ 开头）
 *    实测把 ecvod / vxcd / vxdev 三种解析口径全试一遍都拿不到地址（各 5~6 个样本），
 *    留着只会让用户点进去得到一个空地址。删掉并在下面标注了开关。
 *
 * 4. 【线路排序】按实测可用率重排：聚合线路/box聚合（akamaized，94%）排最前，
 *    其余按实测顺序。只改显示顺序 —— 集标识里的"线路序号"仍指向**原始分组下标**，
 *    所以重排不会串集。
 *
 * 5. 【网页型播放源】原版对 http 开头的 enc 一律原样返回，因此像
 *    `https://www.bilibili.com/bangumi/play/ep752156&t=bilibili` 这种地址会被直接
 *    当成播放地址交给播放器（必然是网页、播不出来）。而 `&t=` 后面那个词正是
 *    解析器认的口径 —— 实测按它走一次能拿到真 mp4（upos-...bilivideo.com）。
 *    这里补上这条兜底：**只在"不像媒体地址"时**才多走一次解析器；
 *    像媒体地址的一律原样返回，不多发一个请求。
 * ─────────────────────────────────────────────────────────────────────────
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

//MARK: - 常量（顶层名统一加 lm 前缀）

/** 版本标记，用来核对线上拿到的到底是哪一版 */
const lmVersionTag = 'lm-v1'

/**
 * 接口域名。实测（3 次 × 4 个候选）：
 *   b4e2ef27af2dec0e.lmm35.com  200 / 686~800ms / 返回 JSON  ✅
 *   b4e2ef27af2dec0e.ho9.cc     200 / 682~981ms / 返回 JSON  ✅
 *   www.lmm85.com 与 lmm85.com  403（接口不挂在这两个域上，只能当 Referer 用）
 * 注意：站点主域只能做 Referer，**不要**把它写进来当接口域名。
 */
const lmApiHosts = ['https://b4e2ef27af2dec0e.lmm35.com', 'https://b4e2ef27af2dec0e.ho9.cc']
/** 云播解析器（原版叫 resolver） */
const lmResolver = 'https://yun.92cj.com'
/** 站点主域，只用于 Referer / 生成播放页地址；接口不在这里（实测 403） */
const lmSite = 'https://www.lmm85.com'
const lmApiPath = '/api.php/Appapi/vod'
const lmUa =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36'
const lmPageLimit = 30
/**
 * sendTimeout / receiveTimeout 的单位在官方文档里没有定论（毫秒读法 30000=30 秒；
 * 秒读法 ≈ 不超时）。取 10000 在两种读法下都安全，而正常一次请求只要 0.3~1s。
 */
const lmTimeoutMs = 10000

/** 解析器用的 AES-128-CBC key/iv（与原 py 逐字节相同） */
const lmKeyHex = '265f4d5026477a465375384d5f6a6b70'
const lmIvHex = '347763794967682b23674b4476285243'

/** 线路 key → 中文名（照抄原版） */
const lmLineNames = {
    ykbox: 'box聚合',
    tudou: '聚合线路',
    xgvxcd: 'vx云播',
    vxdev: 'dev云播',
    dpmp4: 'dp云播',
    dpwxv: 'wxv云播',
    hls: 'hls云播',
    xigua: 'xgsp云播',
    iqiyi: 'iq云播',
    migu: 'migu云播',
    pptv: 'pp云播',
    qqcd: 'qq云播',
    qqqy: 'qqqy云播',
    qxyun: 'qx云播',
    svod: 'svod云播',
    tv189: '189速播',
    link: '外链',
    iframe: 'iframe外链',
}

/**
 * 线路显示优先级（数字小的排前面）。
 * 依据 2026-10-04 实测（每种形态 16 个样本，真拉流判定）：
 *   聚合线路 / box聚合  → resolver type=DU → v16m-default.akamaized.net  94%
 *   vx云播 / dev云播    → groupvideo.photo.qq.com                        100%（但要无 Referer）
 *   hls云播 / dp云播    → 明文地址，多为各家 CDN 的 m3u8/mp4            81%
 * 用户要求「把 100% 可用的聚合线路/box聚合 排到最前」，所以 tudou/ykbox 占 0/1 位。
 */
const lmLineRank = { tudou: 0, ykbox: 1, xgvxcd: 2, vxdev: 3, hls: 4, dpmp4: 5 }
const lmLineRankDefault = 9

const lmYears = ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017']
const lmSorts = [
    ['time', '最近更新'],
    ['hits', '最高人气'],
    ['score', '最高评分'],
    ['up', '最多点赞'],
]

/** 广告标记（原版就有）。实测这些地址**能播**，但播的是广告片，必须过滤。 */
const lmAdMarks = ['adkwai.com', 'adukwai.com', 'ad-dpa', 'advideolp', 'ad_alliance']

/**
 * 解析器已经停用的 enc 形态 —— 留着只会得到空地址。
 * 实测：把 ecvod / vxcd / vxdev 三种口径全部试过，migu云播（纯数字）5 个样本、
 * wxv云播（xv2023_ 开头）6 个样本，**没有一个能拿到地址**。
 * 若站点以后修好了，把对应那条从这里删掉即可。
 */
const lmDeadEncShapes = [
    { re: /^\d+$/, why: 'migu云播（纯数字 enc）' },
    { re: /^xv\d{4}_/, why: 'wxv云播（xv2023_ 开头）' },
]

/** 站点分类兜底（接口拿不到 class 时用，原版就有这份表） */
const lmFallbackClasses = [
    ['6', '日本动漫'],
    ['7', '国产动漫'],
    ['8', '欧美动漫'],
    ['3', '日本动画电影'],
    ['4', '国产动画电影'],
    ['5', '欧美动画电影'],
    ['22', '动态漫画'],
    ['23', '日本特摄剧'],
]

/** 模块级可变状态：自愈到的域名 / 正在进行的竞速 / 分类缓存 */
let lmHealedHost = ''
let lmRaceTask = null
let lmRacePath = ''
let lmRaceResult = null
let lmLastRaceError = ''
let lmClassesCache = null

//MARK: - 小工具

function lmToStr(v) {
    return v === null || v === undefined ? '' : String(v)
}

function lmErrText(e) {
    if (!e) {
        return ''
    }
    if (e.message) {
        return String(e.message)
    }
    return String(e)
}

/** 把 uz 的 req 回包内容统一成文本（data 可能是 string / object / ArrayBuffer） */
function lmDataToText(d) {
    if (d === null || d === undefined) {
        return ''
    }
    if (typeof d === 'string') {
        return d
    }
    if (typeof d === 'object' && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d)) {
        try {
            return JSON.stringify(d)
        } catch (e) {
            return ''
        }
    }
    return ''
}

/**
 * 解析 JSON —— 真机上 req 会按响应头 content-type 自动决定 data 的类型：
 *   application/json        → data 已经是**对象**
 *   text/* 或无 content-type → data 是字符串
 * 所以**绝对不能**写成 JSON.parse(pro.data)（对对象调用必然抛错）。
 */
function lmParseJson(d) {
    if (d === null || d === undefined || d === '') {
        return null
    }
    if (typeof d === 'string') {
        try {
            const j = JSON.parse(d)
            return j
        } catch (e) {
            return null
        }
    }
    if (typeof d === 'object' && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d)) {
        return d
    }
    return null
}

/** Cloudflare 挑战页识别（加体量上限，避免正文里偶然出现 cf_chl_ 被误判） */
function lmIsCloudflare(html) {
    const s = lmToStr(html)
    if (!s || s.length > 30000) {
        return false
    }
    if (/<title>\s*(Just a moment|Attention Required)/i.test(s)) {
        return true
    }
    if (s.indexOf('cf_chl_') !== -1 || s.indexOf('__cf_chl') !== -1) {
        return true
    }
    return false
}

/**
 * 把所有失败情况翻成人话。code === 500 是**二义**的：
 *   真 HTTP 500 → error 为空；网络层直接失败 → error 有 message。
 * 所以判「网络不通」要用 (code === 500 && error) 或 !(code > 0)。
 */
function lmDescribeFailure(code, error, text) {
    const body = lmToStr(text)
    if (lmIsCloudflare(body)) {
        return '站点的人机验证页拦住了请求（Cloudflare），当前网络访问不了，请换网络或开代理后重试'
    }
    const c = Number(code)
    if (c === 403) {
        return '站点返回 403（拒绝访问），可能屏蔽了当前网络/地区，或触发了人机验证'
    }
    if (c === 429) {
        return '站点返回 429（请求太频繁），请稍后重试'
    }
    if (c === 408) {
        return '请求超时'
    }
    if (c === 404) {
        return '站点返回 404（页面不存在）'
    }
    if (!(c > 0)) {
        return '网络请求失败' + (error ? '（' + error + '）' : '') + ' —— 站点可能被网络阻断，需要代理'
    }
    if (c === 500 && error) {
        return '网络请求失败（' + error + '） —— 站点可能被网络阻断，需要代理'
    }
    return '站点返回 HTTP ' + c
}

/** 备注统一成「蝴蝶影视 · xxx」（原版风格） */
function lmFormatRemarks(rem) {
    const s = lmToStr(rem).replace(/[\r\n\t]+/g, ' ').trim()
    return s ? '蝴蝶影视 · ' + s : '蝴蝶影视'
}

//MARK: - AES-128-CBC（原 py 自带一套纯 Python 实现，这里换成真机同款 CryptoJS）

/** CryptoJS 的 WordArray → 字节数组 */
function lmWordsToBytes(wa) {
    const n = wa.sigBytes
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
        out[i] = (wa.words[i >>> 2] >>> (24 - (i & 3) * 8)) & 0xff
    }
    return out
}

/**
 * UTF-8 解码，语义 = Python 的 `bytes.decode('utf-8', 'ignore')`：
 * 遇到非法序列就丢掉、并把指针往前推进一点点继续解（不是整体放弃）。
 * 不用 Crypto.enc.Utf8.stringify 的原因：它对畸形字节会**直接抛异常**，
 * 而 Python 是「忽略非法字节」—— 两者行为不同。
 * （已与 Python 的 417 条畸形字节用例逐字符对拍一致。）
 */
function lmUtf8Ignore(bytes) {
    let out = ''
    let i = 0
    const n = bytes.length
    while (i < n) {
        const b = bytes[i]
        if (b < 0x80) {
            out += String.fromCharCode(b)
            i += 1
            continue
        }
        let need = 0
        let cp = 0
        let minCp = 0
        if (b >= 0xc2 && b <= 0xdf) {
            need = 1
            cp = b & 0x1f
            minCp = 0x80
        } else if (b >= 0xe0 && b <= 0xef) {
            need = 2
            cp = b & 0x0f
            minCp = 0x800
        } else if (b >= 0xf0 && b <= 0xf4) {
            need = 3
            cp = b & 0x07
            minCp = 0x10000
        } else {
            i += 1
            continue
        }
        if (i + need >= n) {
            i += 1
            continue
        }
        let bad = false
        for (let k = 1; k <= need; k++) {
            const c = bytes[i + k]
            if ((c & 0xc0) !== 0x80) {
                bad = true
                break
            }
            cp = (cp << 6) | (c & 0x3f)
        }
        if (bad || cp < minCp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
            i += 1
            continue
        }
        if (cp >= 0x10000) {
            const v = cp - 0x10000
            out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
        } else {
            out += String.fromCharCode(cp)
        }
        i += need + 1
    }
    return out
}

/**
 * AES-128-CBC 解密（NoPadding + 手动剥 PKCS7），完全对齐原 py 的 `_aes_cbc_decrypt`：
 *   · 只处理完整 16 字节块
 *   · padding 非法时**不报错、原样返回**（原版就是这么写的）
 * 已与 Python 侧 131 条随机用例 + 4 条真实 token 逐字节对拍一致。
 */
function lmAesCbcDecryptBytes(ctB64, keyHex, ivHex) {
    const ct = Crypto.enc.Base64.parse(lmToStr(ctB64))
    const full = Math.floor(ct.sigBytes / 16) * 16
    ct.sigBytes = full
    const dec = Crypto.AES.decrypt({ ciphertext: ct }, Crypto.enc.Hex.parse(keyHex), {
        iv: Crypto.enc.Hex.parse(ivHex),
        mode: Crypto.mode.CBC,
        padding: Crypto.pad.NoPadding,
    })
    let bytes = lmWordsToBytes(dec)
    if (bytes.length) {
        const pad = bytes[bytes.length - 1]
        if (pad >= 1 && pad <= 16 && pad <= bytes.length) {
            bytes = bytes.subarray(0, bytes.length - pad)
        }
    }
    return bytes
}

/** 解析器页面里那个 token 的解密（对应原 py 的 `_getc`） */
function lmTokenDecrypt(ctB64) {
    try {
        return lmUtf8Ignore(lmAesCbcDecryptBytes(ctB64, lmKeyHex, lmIvHex))
    } catch (e) {
        return ''
    }
}

//MARK: - 网络

function lmHeaders(extra) {
    const h = { 'User-Agent': lmUa, 'Accept-Language': 'zh-CN,zh;q=0.9' }
    if (extra) {
        const ks = Object.keys(extra)
        for (let i = 0; i < ks.length; i++) {
            h[ks[i]] = extra[ks[i]]
        }
    }
    return h
}

/**
 * 底层请求。返回 { ok, code, json, text, error }
 * 判成功**只看 code 2xx（或 ok()）**，绝不用 `r.error` 判 —— 实测成功时 error 也可能是
 * 真值，用它会报出「请求失败 code=200」这种自相矛盾的错。
 *
 * POST 的写法严格照抄官方源（如 Zhi_qiyou.js）：
 *     method: 'post'                                          ← 小写
 *     headers: { 'content-type': 'application/x-www-form-urlencoded' }   ← 小写 key
 *     data: 'k=v&k2=v2'                                       ← **字符串**
 * 真机 req 只把 options 原样交给原生侧，字符串 data 原样发出、不会被 JSON.stringify。
 * 详见 tools/uz-harness.mjs 里 realReq 的注释。
 */
async function lmRequest(url, headers, opts) {
    const o = opts || {}
    const options = {
        headers: lmHeaders(headers),
        sendTimeout: lmTimeoutMs,
        receiveTimeout: lmTimeoutMs,
    }
    if (o.data !== undefined && o.data !== null) {
        options.method = 'post'
        options.data = o.data
    }
    let p = null
    try {
        p = await req(url, options)
    } catch (e) {
        return { ok: false, code: -1, json: null, text: '', error: '请求异常：' + lmErrText(e) }
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
    if (!ok && !(code >= 200 && code < 300)) {
        return {
            ok: false,
            code: code,
            json: null,
            text: '',
            error: lmDescribeFailure(code, p && p.error, ''),
        }
    }
    const text = lmDataToText(p && p.data)
    return { ok: true, code: code, json: lmParseJson(p && p.data), text: text, error: '' }
}

/** 域名排序：自愈到的域名排第一位（少了这一步，每次请求都会从第 0 个域名重新试一遍） */
function lmDomains() {
    const h = lmHealedHost
    if (!h) {
        return lmApiHosts
    }
    const out = [h]
    for (let i = 0; i < lmApiHosts.length; i++) {
        if (lmApiHosts[i] !== h) {
            out.push(lmApiHosts[i])
        }
    }
    return out
}

/**
 * 线路未知时**并行竞速**：谁先真拿到数据谁赢，不等第一条挂完。
 * （串行重试遇到「连上却不响应」的线路会白等很久。）
 */
function lmRaceApi(path) {
    const ds = lmDomains()
    return new Promise(function (resolve) {
        let left = ds.length
        let done = false
        let lastErr = ''
        function finish(r) {
            if (!done) {
                done = true
                resolve(r)
            }
        }
        function onFail(err) {
            if (err) {
                lastErr = err
            }
            left -= 1
            if (left <= 0) {
                lmLastRaceError = lastErr
                lmRaceResult = null
                finish({ json: null, error: lastErr })
            }
        }
        for (let i = 0; i < ds.length; i++) {
            ;(function (host) {
                lmRequest(host + path)
                    .then(function (r) {
                        if (r.ok && r.json) {
                            if (!done) {
                                lmHealedHost = host
                            }
                            lmLastRaceError = ''
                            lmRaceResult = { json: r.json, error: '' }
                            finish(lmRaceResult)
                            return
                        }
                        onFail(r.error)
                    })
                    .catch(function (e) {
                        onFail(lmErrText(e))
                    })
            })(ds[i])
        }
    })
}

/**
 * 取 JSON 接口。三路：
 *   ① 已经有自愈域名 → 单发快路径（**不要**每次竞速，否则请求数×N）
 *   ② 已有竞速在进行 → 共享它（避免并发调用各自竞速）
 *   ③ 都没有 → 发起竞速，并**同步**把 promise 赋给 lmRaceTask（异步赋值等于没共享）
 */
async function lmApiGet(path) {
    if (lmHealedHost) {
        const r = await lmRequest(lmHealedHost + path)
        if (r.ok && r.json) {
            return { json: r.json, error: '' }
        }
        lmHealedHost = ''
    }
    if (lmRaceTask) {
        await lmRaceTask
        if (lmRacePath === path && lmRaceResult && lmRaceResult.json) {
            return lmRaceResult
        }
    } else {
        lmRacePath = path
        lmRaceResult = null
        const t = lmRaceApi(path)
        lmRaceTask = t
        const clear = function () {
            if (lmRaceTask === t) {
                lmRaceTask = null
            }
        }
        t.then(clear, clear)
        const r = await t
        if (r && r.json) {
            return r
        }
    }
    if (lmHealedHost) {
        const r2 = await lmRequest(lmHealedHost + path)
        if (r2.ok && r2.json) {
            return { json: r2.json, error: '' }
        }
        lmHealedHost = ''
        return { json: null, error: r2.error }
    }
    return { json: null, error: lmLastRaceError || '所有接口域名都请求失败' }
}

//MARK: - 云播解析

/**
 * 走一次解析器：GET 拿 vid/t/token/post → AES 解 token → POST 换直链。
 * 返回直链字符串（拿不到返回空）。
 */
async function lmResolveOnce(enc, referer, typ) {
    const page =
        lmResolver +
        '/yunbox/?type=' +
        encodeURIComponent(typ) +
        '&vid=' +
        enc +
        '&referer=' +
        encodeURIComponent(referer)
    const r1 = await lmRequest(page, { Referer: referer })
    if (!r1.ok || !r1.text) {
        return ''
    }
    const html = r1.text
    function grab(n) {
        const m = html.match(new RegExp('var ' + n + '\\s*=\\s*"([^"]*)"'))
        return m ? m[1] : ''
    }
    const vid = grab('vid')
    const t = grab('t')
    const token = grab('token')
    const mPost = html.match(/post\(\s*"([^"]+)"/)
    const post = mPost ? mPost[1] : ''
    if (!token || !post) {
        return ''
    }
    const base = page.split('?')[0]
    let target = ''
    if (/^https?:\/\//i.test(post)) {
        target = post
    } else {
        target = base.slice(0, base.lastIndexOf('/') + 1) + post.replace(/^\/+/, '')
    }
    const body =
        'vid=' +
        encodeURIComponent(vid) +
        '&t=' +
        encodeURIComponent(t) +
        '&token=' +
        encodeURIComponent(lmTokenDecrypt(token)) +
        '&act=0&play=1'
    const r2 = await lmRequest(
        target,
        {
            Referer: page,
            Origin: lmResolver,
            'content-type': 'application/x-www-form-urlencoded',
        },
        { data: body },
    )
    if (!r2.ok) {
        return ''
    }
    const j = r2.json || lmParseJson(r2.text)
    if (!j || lmToStr(j.code) !== '200') {
        return ''
    }
    return lmToStr(j.url)
}

/** 这个地址看着像不像「媒体地址」（含 m3u8 / 常见视频后缀） */
function lmLooksMedia(u) {
    return /(\.m3u8|\.m3u|\.mp4|\.ts|\.flv|\.mkv|\.mpd|\.m4s|\.mov|\.avi|m3u8)/i.test(lmToStr(u))
}

/**
 * 把详情里的 enc 换成可播放的直链。返回 { url, error }
 * 逻辑与原版 `_resolve` 一致，只在「http 开头但不像媒体地址」时补了一条兜底（见文件头第 5 条）。
 */
async function lmResolve(enc, referer) {
    const e = lmToStr(enc).trim()
    if (!e) {
        return { url: '', error: '这一集没有播放源' }
    }
    if (/^https?:\/\//i.test(e)) {
        // 原版：把 "...xxx.m3u8&t=hls" 这种写成 & 的查询修成 ?xxx
        const m = e.match(/^(https?:\/\/[^&?]*\.(?:m3u8|mp4))&(.+)$/i)
        const u = m ? m[1] + '?' + m[2] : e
        if (lmLooksMedia(u)) {
            return { url: u, error: '' }
        }
        // 兜底：不像媒体地址 —— 尾部 &t=xxx 正是解析器认的口径，按它试一次
        const tm = e.match(/&t=([A-Za-z0-9_]+)\s*$/)
        if (tm) {
            const got = await lmResolveOnce(e, referer, tm[1])
            if (got) {
                return { url: got, error: '' }
            }
            return { url: '', error: '该线路给的是网页地址（' + u.slice(0, 60) + '…），按站点自己的解析口径也没换到视频' }
        }
        return { url: '', error: '该线路给的是网页地址而不是视频地址：' + u.slice(0, 80) }
    }
    // 非 http：按原版的规则决定解析口径
    let types = []
    const mt = e.match(/&t=([A-Za-z0-9_]+)\s*$/)
    if (mt) {
        types = [mt[1]]
    } else if (/^\d+_[a-z0-9]+$/.test(e)) {
        types = ['vxcd', 'vxdev']
    } else {
        types = ['ecvod']
    }
    for (let i = 0; i < types.length; i++) {
        const url = await lmResolveOnce(e, referer, types[i])
        if (url) {
            return { url: url, error: '' }
        }
    }
    return { url: '', error: '云播解析没换出直链（解析口径：' + types.join('/') + '）' }
}

//MARK: - 数据处理

/** 分类列表（带缓存；接口失败退回内置表，绝不让首屏空着） */
async function lmClassesGet() {
    if (lmClassesCache) {
        return { list: lmClassesCache, error: '' }
    }
    const r = await lmApiGet(lmApiPath + '?pg=1&limit=1')
    const out = []
    let err = ''
    if (r.json) {
        const cls = r.json.class || []
        for (let i = 0; i < cls.length; i++) {
            const c = cls[i] || {}
            const cid = lmToStr(c.type_id)
            if (cid === '1' || cid === '2') {
                continue
            }
            out.push([cid, lmToStr(c.type_name)])
        }
    } else {
        err = r.error || '接口没有返回数据'
    }
    if (!out.length) {
        out.push.apply(out, lmFallbackClasses)
        err = '分类接口没取到数据（' + (err || '未知原因') + '），已改用内置分类表'
    }
    lmClassesCache = out
    return { list: out, error: r.json ? '' : err }
}

function lmListFrom(d) {
    const out = []
    const arr = (d && d.list) || []
    for (let i = 0; i < arr.length; i++) {
        const it = arr[i] || {}
        const v = new VideoDetail()
        v.vod_id = lmToStr(it.vod_id)
        v.vod_name = lmToStr(it.vod_name).trim()
        v.vod_pic = lmToStr(it.vod_pic || it.vod_pic_thumb)
        v.vod_remarks = lmFormatRemarks(it.vod_remarks)
        out.push(v)
    }
    return out
}

/** uz 只认 total（RepVideoList 没有 pagecount/limit 字段），所以这里换算成总条数 */
function lmTotal(d, pg) {
    let pc = pg
    const rawPc = d && d.pagecount
    if (rawPc !== undefined && rawPc !== null && lmToStr(rawPc) !== '') {
        const n = parseInt(rawPc, 10)
        if (!isNaN(n) && n > 0) {
            pc = n
        }
    }
    let total = 0
    const rawTotal = d && d.total
    if (rawTotal !== undefined && rawTotal !== null && lmToStr(rawTotal) !== '') {
        const n = parseInt(rawTotal, 10)
        if (!isNaN(n)) {
            total = n
        }
    }
    const min = pc * lmPageLimit
    return total > min ? total : min
}

function lmIsAd(u) {
    const s = lmToStr(u).toLowerCase()
    for (let i = 0; i < lmAdMarks.length; i++) {
        if (s.indexOf(lmAdMarks[i]) !== -1) {
            return true
        }
    }
    return false
}

/**
 * 这一集的 enc 要不要丢掉？
 *   ① 广告地址（实测能播，但播的是广告片）
 *   ② 解析器已停用的形态（实测三种口径全给空）
 * 其余一律保留 —— 特别注意：**不要**按「有没有带 Referer 能拉通」来判死线路，
 * vx云播/dev云播 就是被这条误伤过（真实可用率 100%）。
 */
function lmDropEnc(enc) {
    const e = lmToStr(enc)
    if (/^https?:\/\//i.test(e) && lmIsAd(e)) {
        return true
    }
    for (let i = 0; i < lmDeadEncShapes.length; i++) {
        if (lmDeadEncShapes[i].re.test(e)) {
            return true
        }
    }
    return false
}

/**
 * 拼 vod_play_from / vod_play_url。
 * 集标识固定是 `名称$play|vid|线路序号|集序号`，其中「线路序号 / 集序号」是**原始下标**，
 * 所以后面无论怎么排序显示，播放时都能取回正确的那一集。
 */
function lmBuildPlay(groups, froms, vid) {
    const lines = []
    const used = {}
    for (let i = 0; i < groups.length; i++) {
        const urls = (groups[i] && groups[i].urls) || []
        const eps = []
        for (let ni = 0; ni < urls.length; ni++) {
            const raw = lmToStr(urls[ni] && urls[ni].url).trim()
            if (!raw) {
                continue
            }
            if (lmDropEnc(raw)) {
                continue
            }
            let nm = lmToStr(urls[ni] && urls[ni].name).trim()
            if (!nm) {
                nm = '第' + (ni + 1) + '集'
            }
            eps.push(nm + '$play|' + vid + '|' + (i + 1) + '|' + (ni + 1))
        }
        if (!eps.length) {
            continue
        }
        const key = froms[i] !== undefined ? froms[i] : ''
        let name = lmLineNames[key] || key || '线路' + (i + 1)
        if (used[name]) {
            used[name] += 1
            name = name + used[name]
        } else {
            used[name] = 1
        }
        let rank = lmLineRankDefault
        if (lmLineRank[key] !== undefined) {
            rank = lmLineRank[key]
        }
        lines.push({ name: name, eps: eps, rank: rank, order: i })
    }
    lines.sort(function (a, b) {
        if (a.rank !== b.rank) {
            return a.rank - b.rank
        }
        return a.order - b.order
    })
    const fromArr = []
    const urlArr = []
    for (let i = 0; i < lines.length; i++) {
        fromArr.push(lines[i].name)
        urlArr.push(lines[i].eps.join('#'))
    }
    return { from: fromArr.join('$$$'), url: urlArr.join('$$$') }
}

/** 从 uz 传回来的东西里取出 vid（可能是 id、数组、JSON、带参数的 URL） */
function lmFirstId(v) {
    if (v === null || v === undefined) {
        return ''
    }
    if (v instanceof Array) {
        return v.length ? lmToStr(v[0]) : ''
    }
    if (typeof v === 'object') {
        const keys = ['id', 'vod_id', 'value']
        for (let i = 0; i < keys.length; i++) {
            if (v[keys[i]]) {
                return lmToStr(v[keys[i]])
            }
        }
        return ''
    }
    const s = lmToStr(v).trim()
    if (s.charAt(0) === '[') {
        try {
            const a = JSON.parse(s)
            if (a instanceof Array && a.length) {
                return lmToStr(a[0])
            }
        } catch (e) {
            // 不是 JSON，往下走
        }
    }
    const m = s.match(/\d+/)
    return m ? m[0] : s
}

/** 从接口拿详情原始 list[0] */
async function lmDetailRaw(vid) {
    const r = await lmApiGet(lmApiPath + '?ids=' + encodeURIComponent(vid))
    if (!r.json) {
        return { it: null, error: r.error || '接口没有返回数据' }
    }
    const list = r.json.list || []
    if (!list.length) {
        return { it: null, error: '' }
    }
    return { it: list[0], error: '' }
}

/** 详情里的线路分组（优先 vod_play_url_list，缺了就从 vod_play_url 文本反解，与原版一致） */
function lmGroupsOf(it) {
    let groups = it.vod_play_url_list
    if (!(groups instanceof Array) || !groups.length) {
        const raw = lmToStr(it.vod_play_url)
        groups = []
        const blocks = raw.split('$$$')
        for (let i = 0; i < blocks.length; i++) {
            const parts = blocks[i].split('#')
            const urls = []
            for (let j = 0; j < parts.length; j++) {
                const p = parts[j]
                const at = p.indexOf('$')
                if (at < 0) {
                    continue
                }
                urls.push({ name: p.slice(0, at), url: p.slice(at + 1) })
            }
            groups.push({ urls: urls })
        }
    }
    return groups
}

//MARK: - 筛选项

function lmFilterLabels(items, key) {
    const out = []
    for (let i = 0; i < items.length; i++) {
        const l = new FilterLabel()
        l.name = items[i][1]
        l.id = items[i][0]
        l.key = key
        out.push(l)
    }
    return out
}

function lmFilters() {
    const out = []
    // 年份
    const years = [['', '全部']]
    for (let i = 0; i < lmYears.length; i++) {
        years.push([lmYears[i], lmYears[i]])
    }
    years.push(['2016-1980', '更早'])
    const t1 = new FilterTitle()
    t1.name = '年份'
    t1.list = lmFilterLabels(years, 'year')
    out.push(t1)
    // 排序
    const sorts = []
    for (let i = 0; i < lmSorts.length; i++) {
        sorts.push([lmSorts[i][0], lmSorts[i][1]])
    }
    const t2 = new FilterTitle()
    t2.name = '排序'
    t2.list = lmFilterLabels(sorts, 'by')
    out.push(t2)
    return out
}

/** 把 uz 传回的 filter[] 收成 { year, by }。key 缺失时按位置兜底（顺序就是 getSubclassList 给的顺序） */
function lmPickFilter(arr) {
    const keys = ['year', 'by']
    const out = {}
    if (arr instanceof Array) {
        for (let i = 0; i < arr.length; i++) {
            const f = arr[i] || {}
            let k = lmToStr(f.key)
            if (keys.indexOf(k) < 0) {
                k = keys[i] || ''
            }
            const v = lmToStr(f.id).trim()
            if (k && v) {
                out[k] = v
            }
        }
    }
    return out
}

/** 分类列表请求（无筛选 / 带筛选共用） */
async function lmFetchList(tid, page, year, by) {
    const params = ['t=' + encodeURIComponent(tid), 'pg=' + page, 'limit=' + lmPageLimit]
    if (year) {
        params.push('year=' + encodeURIComponent(year))
    }
    if (by) {
        params.push('by=' + encodeURIComponent(by))
    }
    return await lmApiGet(lmApiPath + '?' + params.join('&'))
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
        const r = await lmClassesGet()
        const list = []
        for (let i = 0; i < r.list.length; i++) {
            const vc = new VideoClass()
            vc.type_id = r.list[i][0]
            vc.type_name = r.list[i][1]
            // 本站每个分类都有「年份 / 排序」筛选面板
            vc.hasSubclass = true
            list.push(vc)
        }
        backData.data = list
        if (r.error) {
            backData.error = r.error
        }
    } catch (error) {
        backData.error = '获取分类失败～' + lmErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 筛选列表（年份 / 排序）。本站所有分类共用同一套筛选项。
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoSubclassList())
 */
async function getSubclassList(args) {
    var backData = new RepVideoSubclassList()
    try {
        const sub = new VideoSubclass()
        sub.class = []
        sub.filter = lmFilters()
        backData.data = sub
    } catch (error) {
        backData.error = '获取筛选项失败～' + lmErrText(error)
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
        const tid = lmToStr(args && args.url).trim() || '6'
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        const r = await lmFetchList(tid, page, '', '')
        if (!r.json) {
            backData.error = '列表获取失败：' + (r.error || '接口没有返回数据')
            return JSON.stringify(backData)
        }
        backData.data = lmListFrom(r.json)
        backData.total = lmTotal(r.json, page)
        if (!backData.data.length) {
            backData.error = '这个分类的第 ' + page + ' 页没有数据'
        }
    } catch (error) {
        backData.error = '获取列表失败～' + lmErrText(error)
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
        const tid = lmToStr((args && args.mainClassId) || (args && args.url)).trim() || '6'
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        const f = lmPickFilter(args && args.filter)
        const r = await lmFetchList(tid, page, f.year || '', f.by || '')
        if (!r.json) {
            backData.error = '列表获取失败：' + (r.error || '接口没有返回数据')
            return JSON.stringify(backData)
        }
        backData.data = lmListFrom(r.json)
        backData.total = lmTotal(r.json, page)
        if (!backData.data.length) {
            backData.error = '当前筛选条件下第 ' + page + ' 页没有数据（可换个年份或排序试试）'
        }
    } catch (error) {
        backData.error = '获取列表失败～' + lmErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 视频详情。vod_play_url 里只存标识（标识里带原始线路/集下标），
 * 真正的直链留到播放时现取 —— 这样不受签名过期影响。
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoDetail())
 */
async function getVideoDetail(args) {
    var backData = new RepVideoDetail()
    try {
        const vid = lmFirstId(args && args.url)
        if (!vid) {
            backData.error = '无效的视频 ID：' + JSON.stringify(lmToStr(args && args.url))
            return JSON.stringify(backData)
        }
        const d = await lmDetailRaw(vid)
        if (!d.it) {
            // 详情页失败不能返回「空壳详情」—— 那会让用户以为详情能用、只是播放器坏了
            backData.error = d.error ? '影片详情获取失败：' + d.error : '影片详情为空（该片可能已下架）'
            return JSON.stringify(backData)
        }
        const it = d.it
        const froms = lmToStr(it.vod_play_from).split('$$$')
        const groups = lmGroupsOf(it)
        const play = lmBuildPlay(groups, froms, vid)

        const pic = lmToStr(it.vod_pic || it.vod_pic_thumb)
        let content = lmToStr(it.vod_blurb || it.vod_content)
        content = content.replace(/\n/g, ' ')

        const v = new VideoDetail()
        v.vod_id = vid
        v.vod_name = lmToStr(it.vod_name).trim()
        v.vod_pic = pic
        v.type_name = lmToStr(it.type_name)
        v.vod_year = lmToStr(it.vod_year)
        v.vod_area = lmToStr(it.vod_area)
        v.vod_lang = lmToStr(it.vod_lang)
        v.vod_remarks = lmFormatRemarks(it.vod_remarks)
        v.vod_actor = '🦋 TG群: @tvshare23'
        v.vod_director = '🦋 蝴蝶影视'
        v.vod_content = content
        v.vod_play_from = play.from
        v.vod_play_url = play.url
        if (lmToStr(it.vod_score)) {
            v.vod_douban_score = lmToStr(it.vod_score)
        }
        backData.data = v

        if (!play.url) {
            backData.error =
                '这部片没有可用的播放线路（源站给的线路要么是广告、要么是云播解析器已经停用的那两条）'
        }
    } catch (error) {
        backData.error = '获取详情失败～' + lmErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 播放地址
 * @param {UZArgs} args  args.url 形如 play|vid|线路序号|集序号
 * @returns {Promise<string>} JSON.stringify(new RepVideoPlayUrl())
 */
async function getVideoPlayUrl(args) {
    var backData = new RepVideoPlayUrl()
    try {
        const raw = lmToStr(args && args.url).trim()
        const m = raw.match(/^play\|(\d+)\|(\d+)\|(\d+)$/)
        if (!m) {
            // 兼容：极少数情况下 App 直接把地址或 "名称$标识" 塞进来
            let cand = raw
            const at = cand.indexOf('$')
            if (at !== -1) {
                cand = cand.slice(at + 1).trim()
            }
            const m2 = cand.match(/^play\|(\d+)\|(\d+)\|(\d+)$/)
            if (m2) {
                return await getVideoPlayUrl({ url: cand })
            }
            if (/^https?:\/\//i.test(cand)) {
                const r = await lmResolve(cand, lmSite + '/')
                if (!r.url) {
                    backData.error = r.error
                    return JSON.stringify(backData)
                }
                backData.data = r.url
                backData.headers = { 'User-Agent': lmUa }
                return JSON.stringify(backData)
            }
            backData.error = '无效的播放标识：' + JSON.stringify(raw)
            return JSON.stringify(backData)
        }
        const vid = m[1]
        const si = parseInt(m[2], 10)
        const ni = parseInt(m[3], 10)

        const d = await lmDetailRaw(vid)
        if (!d.it) {
            backData.error = d.error ? '播放地址获取失败（重新取详情出错）：' + d.error : '这部片在源站已经没有数据了'
            return JSON.stringify(backData)
        }
        const groups = lmGroupsOf(d.it)
        let enc = ''
        if (si >= 1 && si <= groups.length) {
            const urls = (groups[si - 1] && groups[si - 1].urls) || []
            if (ni >= 1 && ni <= urls.length) {
                enc = lmToStr(urls[ni - 1] && urls[ni - 1].url)
            }
        }
        if (!enc) {
            const blocks = lmToStr(d.it.vod_play_url).split('$$$')
            if (si >= 1 && si <= blocks.length) {
                const eps = blocks[si - 1].split('#')
                if (ni >= 1 && ni <= eps.length && eps[ni - 1].indexOf('$') !== -1) {
                    enc = eps[ni - 1].slice(eps[ni - 1].indexOf('$') + 1)
                }
            }
        }
        if (!enc) {
            backData.error = '第 ' + si + ' 条线路的第 ' + ni + ' 集没有可用的播放源'
            return JSON.stringify(backData)
        }

        const referer = lmSite + '/play/' + vid + '_' + si + '_' + ni + '.html'
        const r = await lmResolve(enc, referer)
        if (!r.url) {
            backData.error = '解析失败：' + r.error
            return JSON.stringify(backData)
        }
        let finalUrl = r.url
        // 与原版一致：地址里看不出媒体后缀时补一个 format=.m3u8
        //（比原版收得更紧：`upload_m3u8/...` 这种路径里带 m3u8 的也算媒体，不去画蛇添足）
        if (!lmLooksMedia(finalUrl)) {
            finalUrl += (finalUrl.indexOf('?') >= 0 ? '&' : '?') + 'format=.m3u8'
        }
        backData.data = finalUrl
        // 🔴 播放头只给 UA，**绝不加 Referer**：
        //    groupvideo.photo.qq.com 带 Referer 会 404，不带才是 206（实测 5 轮 × 4 条）。
        backData.headers = { 'User-Agent': lmUa }
    } catch (error) {
        backData.error = '获取播放地址失败～' + lmErrText(error)
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
        const kw = lmToStr(args && args.searchWord).trim()
        if (!kw) {
            return JSON.stringify(backData)
        }
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        const path =
            lmApiPath +
            '?wd=' +
            encodeURIComponent(kw) +
            '&pg=' +
            page +
            '&limit=' +
            lmPageLimit
        const r = await lmApiGet(path)
        if (!r.json) {
            backData.error = '搜索失败：' + (r.error || '接口没有返回数据')
            return JSON.stringify(backData)
        }
        backData.data = lmListFrom(r.json)
        backData.total = lmTotal(r.json, page)
        if (!backData.data.length) {
            backData.error = page > 1 ? '第 ' + page + ' 页没有更多结果了' : '没搜到「' + kw + '」'
        }
    } catch (error) {
        backData.error = '搜索失败～' + lmErrText(error)
    }
    return JSON.stringify(backData)
}
