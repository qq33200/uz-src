// ignore
//@name:[禁] StripChat
//@version:6
//@webSite:https://zh.stripchat.com
//@remark:StripChat 直播，三域名自愈，按国家/标签筛选。播放直连官方 HLS，不需要代理。；v6：彻底移除广告节点 doppiocdn（v5 只把它降为兜底，真机上 sacfedge 一旦失败仍会落到它、继续放广告），并加固文本读取（真机 m3u8 可能不是字符串，会让广告检测失效）；v5：拉流节点换回 sacfedge；v4 提速：①已探明的可用域名优先复用 ②线路未知时三域名并行竞速 ③请求加 10 秒超时
//@type:100
//@instance:stripchat2026
//@isAV:1
//@order: E
import { } from '../../core/uzVideo.js'
import { } from '../../core/uzHome.js'
import { } from '../../core/uz3lib.js'
import { } from '../../core/uzUtils.js'
// ignore

/** 三条官方线路，顺序即优先级 */
const scDomains = ['https://zh.stripchat.com', 'https://zh.stripchat.global', 'https://zh.stripol.com']

/**
 * 拉流用的边缘节点。
 *
 * 🔴 2026-09-28 实测（关键结论，别再按「谁快用谁」调回去）：
 *   **只有 sacfedge 给的是真实直播流，doppiocdn 一族给的是广告。**
 *   判据：取 3 个不同主播、经两个节点各拉一次首分片算 sha256 ——
 *     · doppiocdn（.org / .media 都一样）→ **3 个主播的首分片完全同一个文件**
 *       （131824 B，路径 `/b-hls-xx/cpa/v2/chunk_000.m4s`，cpa = 广告投放）
 *     · sacfedge → 每路各不相同，路径含房间号 + 签名
 *       （`/b-hls-xx/<房间号>/<房间号>_480p_h264_<签名>.mp4`）
 *
 * ⚠️ 这里连踩两次，两次都是「广告」：
 *   · v4：只看了「响应快不快」就把 doppiocdn 提到第一位（它确实更快 0.43s vs 0.92s，
 *     但快的是广告）→ 所有直播间都变成「加载很久 → 放 20 秒广告」。
 *   · v5：把 sacfedge 放回第一位，**但把 doppiocdn 留在了第二位当兜底** ——
 *     真机上 sacfedge 一旦拉不到（国内网络很常见），就会落到它，**又是广告**。
 *
 * → **v6 直接把 doppiocdn 移除。** 一个只给广告的地址没有任何兜底价值：
 *   拉不到就该报错（用户能看懂「拉不到直播清单」），绝不能把广告塞给播放器。
 */
const scEdgeMasters = [
    'https://edge-hls.sacfedge.com/hls/{id}/master/{id}_auto.m3u8?playlistType=lowLatency',
]

/**
 * 广告分片的路径特征。
 * 出现在媒体清单里就说明这一路拿到的是广告片（而不是该房间的直播流）。
 * 留着它作为最后一道保险：万一将来唯一节点也开始给广告，宁可报错也不放广告。
 */
const scAdSegMark = '/cpa/'

/** 版本标记，会显示在详情页正文里 —— 方便确认 App 里跑的是哪一版（排查用） */
const scVersionTag = 'v6'

/** 每页多少个主播 */
const scPageSize = 60

/** 搜索时每个分类各取多少条 */
const scSearchLimit = 30

/**
 * 弹幕开关。默认关闭。
 * uzVideo 只在进入播放时调用一次 getVideoPlayUrl，拿到的只能是「那一刻」的聊天记录快照，
 * 之后不会再拉新消息，所以它更像是「进房时把最近的聊天刷一遍」而不是真正的实时弹幕。
 * 想体验就把下面改成 true。
 */
const scEnableDanmu = false

/** 快照弹幕的间隔秒数（把最近若干条聊天按这个间隔铺开） */
const scDanmuInterval = 2

const scUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0'

/**
 * 单次请求超时。
 *
 * ⚠️ uz 的 sendTimeout / receiveTimeout 单位没有定论（见扩展开发笔记）：
 *   - 读作毫秒 → 10000 = 10 秒（够用：列表 JSON 84KB，实测 0.6s）
 *   - 读作秒   → 10000 ≈ 2.7 小时 = 相当于不超时（与不传的默认值同档）
 * 两种读法都安全，且**不会比原版更差**（原版不传，默认 30000）。
 *
 * 为什么值得传：本扩展在「域名不通」时会串行试多条线路，
 * 若某条线路是「连上但不响应」的黑洞，不传超时就要干等默认值（毫秒读法下 30 秒）。
 */
const scTimeoutMs = 10000

/**
 * 把 req 的返回值安全地解析成 JSON 对象。
 *
 * ⚠️ 关键：uz 的 `req` 会按响应头 content-type 自动决定 `data` 的类型 ——
 * content-type 是 application/json 时，`data` 已经是**解析好的对象**；
 * 是 text/* 或无 content-type 时 `data` 才是字符串。
 * 所以**绝对不能无条件 `JSON.parse(pro.data)`**，那会在真机上直接抛 "Unexpected token o"。
 * 官方扩展也是这么兼容的，见 panTools2.js: `typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data`
 */
function scParseJsonData(d) {
    if (d === null || d === undefined || d === '') {
        return null
    }
    if (typeof d === 'string') {
        try {
            return JSON.parse(d)
        } catch (e) {
            return null
        }
    }
    // 已解析好的对象（排除二进制)
    if (typeof d === 'object' && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d)) {
        return d
    }
    return null
}

/**
 * 把 req 的返回值安全地取成文本（m3u8 / HTML 用）。
 *
 * 早期只处理 `typeof d === 'string'`，其余一律返回空串 —— 一旦真机上 m3u8 的
 * content-type 没被识别成文本（`data` 是 ArrayBuffer / Uint8Array），
 * 「有没有清单」的判断和广告探测就会**一起失效**（探测失效 = 广告地址被原样交给播放器）。
 * 这里把二进制形态也解开。
 */
function scAsText(d) {
    if (d === null || d === undefined) {
        return ''
    }
    if (typeof d === 'string') {
        return d
    }
    if (d instanceof ArrayBuffer) {
        try {
            return scDecodeUtf8(new Uint8Array(d))
        } catch (e) {
            return ''
        }
    }
    if (ArrayBuffer.isView(d)) {
        try {
            return scDecodeUtf8(new Uint8Array(d.buffer, d.byteOffset, d.byteLength))
        } catch (e) {
            return ''
        }
    }
    return ''
}

/** UTF-8 解码（TextDecoder 不一定存在于宿主引擎，给个纯手写的兜底） */
function scDecodeUtf8(u8) {
    if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder('utf-8').decode(u8)
    }
    let s = ''
    let i = 0
    while (i < u8.length) {
        const c = u8[i++]
        if (c < 0x80) {
            s += String.fromCharCode(c)
        } else if (c < 0xe0) {
            s += String.fromCharCode(((c & 0x1f) << 6) | (u8[i++] & 0x3f))
        } else if (c < 0xf0) {
            s += String.fromCharCode(((c & 0x0f) << 12) | ((u8[i++] & 0x3f) << 6) | (u8[i++] & 0x3f))
        } else {
            const cp = ((c & 0x07) << 18) | ((u8[i++] & 0x3f) << 12) | ((u8[i++] & 0x3f) << 6) | (u8[i++] & 0x3f)
            const v = cp - 0x10000
            s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
        }
    }
    return s
}

/** 从 URL 里取「协议+域名」 */
function scOriginOf(url) {
    const m = String(url || '').match(/^(https?:\/\/[^\/]+)/i)
    return m ? m[1] : ''
}

class scStripchatClass extends WebApiBase {
    constructor() {
        super()
        // 自愈到可用域名后记在这里，后续请求都用它
        this._healedHost = ''
        // 正在进行的「并行选路」任务；并发调用共享它，避免各自竞速把请求数翻倍
        this._raceTask = null
    }

    //MARK: - 分类

    /**
     * @param {UZArgs} args
     * @returns {Promise<RepVideoClassList>}
     */
    async getClassList(args) {
        let backData = new RepVideoClassList()
        try {
            let webUrl = String(args.url || '')
            if (/^https?:/i.test(webUrl)) {
                this.webSite = this.removeTrailingSlash(webUrl)
            }
            const cfgHost = this.hostOf(this.webSite)
            if (cfgHost) {
                this._orderDomains(cfgHost)
            }

            const raw = [
                ['👩 女主播', 'girls'],
                ['💑 情侣', 'couples'],
                ['👨 男主播', 'men'],
                ['⚧ 跨性别', 'trans'],
            ]
            let list = []
            for (let i = 0; i < raw.length; i++) {
                let videoClass = new VideoClass()
                videoClass.type_id = raw[i][1]
                videoClass.type_name = raw[i][0]
                videoClass.hasSubclass = true
                list.push(videoClass)
            }
            backData.data = list
        } catch (error) {
            backData.error = '获取分类失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    /**
     * 标签筛选
     * @param {UZArgs} args
     * @returns {Promise<RepVideoSubclassList>}
     */
    async getSubclassList(args) {
        let backData = new RepVideoSubclassList()
        try {
            const tid = String(args.url || '')
            let sub = new VideoSubclass()
            sub.class = []
            sub.filter = this.buildTagFilter(tid)
            backData.data = sub
        } catch (error) {
            backData.error = '获取筛选项失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 列表

    /**
     * @param {UZArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async getVideoList(args) {
        return this.listByTag(String(args.url || ''), args.page || 1, '')
    }

    /**
     * @param {UZSubclassVideoListArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async getSubclassVideoList(args) {
        const mainId = String(args.mainClassId || args.url || '')
        const filters = this.readFilters(args.filter)
        return this.listByTag(mainId, args.page || 1, filters.tag || '')
    }

    async listByTag(tid, page, tag) {
        let backData = new RepVideoList()
        try {
            let t = String(tid || '')
            if (t.indexOf('@@') !== -1) {
                t = t.split('@@')[t.split('@@').length - 1]
            }
            if (!t) {
                t = 'girls'
            }
            const offset = scPageSize * (page > 0 ? page - 1 : 0)
            let path =
                '/api/front/models?improveTs=false&removeShows=false&limit=' +
                scPageSize +
                '&offset=' +
                offset +
                '&primaryTag=' +
                encodeURIComponent(t) +
                '&sortBy=stripRanking&rcmGrp=A&rbCnGr=true&prxCnGr=false&nic=false'
            if (tag) {
                path += '&filterGroupTags=[["' + encodeURIComponent(tag) + '"]]'
            }
            const r = await this.apiGet(path)
            backData.error = r.error
            const json = r.json || {}
            backData.data = this.parseModels(json.models || [])
            const total = parseInt(json.filteredCount, 10)
            backData.total = total > 0 ? total : 9999
        } catch (error) {
            backData.error = '获取列表失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 详情

    /**
     * @param {UZArgs} args
     * @returns {Promise<RepVideoDetail>}
     */
    async getVideoDetail(args) {
        let backData = new RepVideoDetail()
        try {
            const uid = String(args.url || '').trim()
            if (!uid) {
                backData.error = '主播 ID 为空'
                return JSON.stringify(backData)
            }

            let detModel = new VideoDetail()
            detModel.vod_id = uid
            detModel.vod_name = 'StripChat 直播间 ' + uid
            detModel.vod_pic = 'https://img.doppiocdn.org/snapshot/' + uid + '/' + Math.floor(Date.now() / 1000)
            detModel.vod_remarks = '🔴 直播中'
            detModel.vod_director = '🦋 蝴蝶影视'
            detModel.vod_actor = '🦋 TG群: @tvshare23'
            detModel.vod_area = '全球'
            detModel.type_name = '直播'
            detModel.vod_content =
                '【🔥 官方交流群: ' +
                'https://t.me/tvshare23' +
                '】\n【当前线路: ' +
                this.curHost() +
                '】\n【扩展版本: ' +
                scVersionTag +
                '】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                'StripChat 直播直连。\n' +
                '门票房（🎫）对未付费游客只放广告片，属正常现象，换个 🔴 免费房即可。'
            // 与原 py 的 detailContent 一致：给三条线路（主线路 / 备用线路 / 备用线路三），
            // 三条最终都会去拉同一个 HLS 清单，作用相当于 TVBox 里的「换源」。
            detModel.vod_play_from = '线路一$$$线路二$$$线路三'
            detModel.vod_play_url =
                '主线路$' + uid + '$$$备用线路$lemon_' + uid + '$$$备用线路三$sacf_' + uid
            backData.data = detModel
        } catch (error) {
            backData.error = '获取详情失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 播放

    /**
     * 对齐原 py 的 playerContent：
     *   sid = id.split('_')[-1]
     *   先拉 sacfedge master，失败再降级 doppiocdn master
     *   把 #EXT-X-STREAM-INF 后面的那一行作为播放地址（各画质一条）
     *
     * master 里的 #EXT-X-MOUFLON:PSCH、variant 里的 #EXT-X-MOUFLON:EXT-REF 都是附加标签，
     * 播放器按非标准标签忽略即可；真正的分片地址是明文的，所以直连即可，不需要代理。
     * @param {UZArgs} args
     * @returns {Promise<RepVideoPlayUrl>}
     */
    async getVideoPlayUrl(args) {
        let backData = new RepVideoPlayUrl()
        try {
            // 三条线路分别给 uid / lemon_uid / sacf_uid，统一取最后一段当主播 ID
            const sid = String(args.url || '')
                .trim()
                .split('_')
                .pop()
            if (!/^\d+$/.test(sid)) {
                backData.error = '主播 ID 解析失败'
                return JSON.stringify(backData)
            }

            const headers = {
                'User-Agent': scUa,
                Origin: this.curHost(),
                Referer: this.curHost() + '/',
            }
            backData.headers = headers

            let variants = []
            let sawAd = false
            const diag = []
            for (let i = 0; i < scEdgeMasters.length; i++) {
                const node = this.hostOf(scEdgeMasters[i])
                const master = scEdgeMasters[i].split('{id}').join(sid)
                const r = await this.get(master)
                const text = scAsText(r.data)
                if (r.code !== 200 || text.indexOf('#EXT-X-STREAM-INF') === -1) {
                    diag.push(node + ' HTTP' + r.code + (text ? ' 无清单' : ' 空响应'))
                    continue
                }
                const vs = this.parseVariants(text, master)
                if (!vs.length) {
                    diag.push(node + ' 无档位')
                    continue
                }
                // 探一眼首档的真实分片清单：若出现广告分片特征，说明这一路在给广告，不用它
                const probe = await this.get(vs[0].url)
                const probeText = scAsText(probe.data)
                if (probeText && probeText.indexOf(scAdSegMark) !== -1) {
                    sawAd = true
                    diag.push(node + ' 广告流已拦下')
                    continue
                }
                variants = vs
                break
            }

            if (!variants.length) {
                backData.error = sawAd
                    ? '取到的是广告流（CDN 推的），已拦下不给播放。请换个主播或稍后再试'
                    : '拉不到直播清单，可能已下播，或当前网络连不上拉流节点' +
                      (diag.length ? '（' + diag.join('；') + '）' : '')
                return JSON.stringify(backData)
            }

            let urls = []
            for (let i = 0; i < variants.length; i++) {
                urls.push({ name: variants[i].name, url: variants[i].url, headers: headers })
            }
            backData.urls = urls

            if (scEnableDanmu) {
                backData.danMu = await this.fetchDanmu(sid)
            }
        } catch (error) {
            backData.error = '获取播放地址失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    parseVariants(text, fallbackUrl) {
        const lines = String(text).split('\n')
        let out = []
        let pendingName = ''
        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i].trim()
            if (ln.indexOf('#EXT-X-STREAM-INF') === 0) {
                const m = ln.match(/NAME="([^"]+)"/)
                pendingName = m ? m[1] : ''
                continue
            }
            if (ln && ln.indexOf('#') !== 0) {
                let url = ln
                if (!/^https?:\/\//i.test(url)) {
                    url = this.absAgainst(fallbackUrl, url)
                }
                if (url) {
                    out.push({ name: pendingName || '线路 ' + (out.length + 1), url: url })
                }
                pendingName = ''
            }
        }
        if (!out.length && text && text.indexOf('#EXTINF') !== -1) {
            // master 本身就是 media playlist
            out.push({ name: '原画', url: fallbackUrl })
        }
        return out
    }

    absAgainst(base, rel) {
        const m = String(base).match(/^(https?:\/\/[^\/]+)/i)
        if (!m) {
            return rel
        }
        return rel.indexOf('/') === 0 ? m[1] + rel : m[1] + '/' + rel
    }

    //MARK: - 搜索

    /**
     * 四个分类并行搜，结果按 id 去重
     * @param {UZArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async searchVideo(args) {
        let backData = new RepVideoList()
        try {
            const kw = String(args.searchWord || '').trim()
            if (!kw) {
                return JSON.stringify(backData)
            }
            const tags = ['girls', 'couples', 'men', 'trans']
            const jobs = []
            for (let i = 0; i < tags.length; i++) {
                jobs.push(
                    this.apiGet(
                        '/api/front/v4/models/search/group/username?query=' +
                            encodeURIComponent(kw) +
                            '&limit=' +
                            scSearchLimit +
                            '&primaryTag=' +
                            tags[i]
                    )
                )
            }
            const results = await Promise.all(jobs)

            let merged = []
            let seen = {}
            for (let i = 0; i < results.length; i++) {
                const json = (results[i] && results[i].json) || {}
                const ms = json.models || []
                for (let j = 0; j < ms.length; j++) {
                    const id = String(ms[j].id || '')
                    if (!id || seen[id]) {
                        continue
                    }
                    seen[id] = 1
                    merged.push(ms[j])
                }
            }
            backData.data = this.parseModels(merged)
            backData.total = merged.length
        } catch (error) {
            backData.error = '搜索失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 弹幕（可选）

    async fetchDanmu(roomId) {
        const r = await this.apiGet(
            '/api/front/v2/models/' + roomId + '/chat?source=regular&uniq=' + Date.now()
        )
        const json = r.json || {}
        const arr = json.messages
        if (!arr || !arr.length) {
            return []
        }
        // 取最近 20 条，按时间正序铺开
        let picked = arr.slice(0, 20).reverse()
        let out = []
        for (let i = 0; i < picked.length; i++) {
            const item = this.normalizeChat(picked[i])
            if (!item) {
                continue
            }
            out.push({ content: item, time: i * scDanmuInterval })
        }
        return out
    }

    normalizeChat(msg) {
        try {
            if (!msg || typeof msg !== 'object') {
                return ''
            }
            const details = msg.details || {}
            let text = msg.text || msg.message || msg.content || msg.body || ''
            if (!text && details && typeof details === 'object') {
                text = details.body || details.message || details.text || ''
            }
            if (text && typeof text === 'object') {
                text = text.text || text.body || ''
            }
            const tp = msg.type || ''
            if (!text && tp === 'tip') {
                const amount = details && typeof details === 'object' ? details.amount || details.tokens || '' : ''
                text = amount ? '打赏 ' + amount + ' tk' : '打赏'
            }
            if (!text && tp === 'lovense') {
                text = 'Lovense 互动'
            }
            let user = ''
            const ud = msg.userData || msg.user || msg.sender || {}
            if (ud && typeof ud === 'object') {
                user = ud.username || ud.name || ud.login || ''
            } else if (typeof ud === 'string') {
                user = ud
            }
            if (!user) {
                user = msg.username || msg.userName || ''
            }
            text = String(text).trim()
            user = String(user).trim()
            if (!text) {
                return ''
            }
            const show = (user ? user + ': ' : '') + this.replaceEmoji(text)
            return show.slice(0, 80)
        } catch (e) {
            return ''
        }
    }

    replaceEmoji(text) {
        const map = {
            ':heart:': '❤️',
            ':dancing:': '💃',
            ':thumbsup:': '👍',
            ':flower:': '🌹',
            ':lol:': '😄',
            ':flirt:': '😉',
            ':devil:': '😈',
            ':hideeyes:': '🙈',
            ':ask:': '❓',
            ':inlove:': '😍',
            ':tongue:': '😛',
            ':cry:': '😭',
            ':fire:': '🔥',
            ':asking:': '🤔',
            ':wink:': '😉',
            ':ok:': '👌',
            ':shy:': '😳',
            ':angry:': '😡',
            ':ass:': '🍑',
        }
        let s = String(text)
        const keys = Object.keys(map)
        for (let i = 0; i < keys.length; i++) {
            s = s.split(keys[i]).join(map[keys[i]])
        }
        return s
    }

    //MARK: - 解析

    parseModels(models) {
        let out = []
        for (let i = 0; i < models.length; i++) {
            const m = models[i] || {}
            const id = String(m.id === undefined || m.id === null ? '' : m.id).trim()
            if (!id) {
                continue
            }
            const status = String(m.status || 'off')
            const isLive = m.isLive === true || status === 'public' || status === 'groupShow' || status === 'ticket'
            const viewers = m.viewersCount || 0
            const name = this.countryFlag(String(m.country || '')) + String(m.username || id)
            const ts = String(m.snapshotTimestamp || '')
            let pic = ''
            if (isLive && ts) {
                pic = 'https://img.doppiocdn.org/snapshot/' + id + '/' + ts
            } else {
                pic = m.previewUrlThumbSmall || m.avatarUrl || ''
            }
            out.push({
                vod_id: id,
                vod_name: name,
                vod_pic: pic,
                vod_remarks: this.statusRemark(isLive, status, viewers),
            })
        }
        return out
    }

    statusRemark(isLive, status, viewers) {
        let st = '⚫已下播'
        if (isLive) {
            if (status === 'public') {
                st = '🔴直播中'
            } else if (status === 'groupShow') {
                st = '🎫门票房'
            } else if (status === 'ticket') {
                st = '🎫购票房'
            } else {
                st = '🎫' + status
            }
        }
        return viewers ? st + ' 👤' + viewers + '人' : st
    }

    countryFlag(code) {
        const c = String(code || '')
        if (c.length !== 2 || !/^[A-Za-z]+$/.test(c)) {
            return ''
        }
        let out = ''
        for (let i = 0; i < 2; i++) {
            out += String.fromCharCode(c.toUpperCase().charCodeAt(i) - 65 + 0x1f1e6)
        }
        return out
    }

    buildTagFilter(tid) {
        // 原 py 里 VALUE 有重复项（autoTagNew / ethnicityAsian / autoTagVr / ageTeen 各出现两次），这里去重
        let pairs = [
            ['新主播', 'autoTagNew'],
            ['推荐', 'recommended'],
            ['炮机', 'fuckMachine'],
            ['青年', 'ageTeen'],
            ['VR', 'autoTagVr'],
            ['亚洲人', 'ethnicityAsian'],
            ['🇨🇳中国', 'tagLanguageChinese'],
            ['🇯🇵日本', 'tagLanguageJapanese'],
            ['🇰🇷韩国', 'tagLanguageKorean'],
            ['🇻🇳越南', 'tagLanguageVietnamese'],
            ['🇺🇦乌克兰', 'tagLanguageUkrainian'],
            ['🇷🇺俄罗斯', 'tagLanguageRussianSpeaking'],
            ['🇺🇸美国', 'tagLanguageUSModels'],
            ['🇨🇴哥伦比亚', 'tagLanguageColombian'],
            ['🇩🇪德国', 'tagLanguageGermanSpeaking'],
            ['🇫🇷法国', 'tagLanguageFrench'],
            ['🇬🇧英国', 'tagLanguageUKModels'],
            ['🇨🇦加拿大', 'tagLanguageCanadian'],
            ['🇲🇽墨西哥', 'tagLanguageMexican'],
            ['🇮🇳印度', 'ethnicityIndian'],
            ['🇻🇪委内瑞拉', 'tagLanguageVenezuelan'],
            ['🇷🇴罗马尼亚', 'tagLanguageRomanian'],
            ['🌍非洲', 'tagLanguageAfrican'],
            ['🇪🇸西班牙', 'tagLanguageSpanishSpeaking'],
            ['🇸🇦🇦🇪阿拉伯', 'ethnicityMiddleEastern'],
            ['🇰🇪肯尼亚', 'tagLanguageKenyan'],
            ['🇿🇦南非', 'tagLanguageSouthAfrican'],
            ['🇧🇷巴西', 'tagLanguageBrazilian'],
            ['🇹🇭泰国', 'tagLanguageThai'],
            ['🇮🇹意大利', 'tagLanguageItalian'],
            ['白人', 'ethnicityWhite'],
            ['拉丁', 'ethnicityLatino'],
            ['混血', 'ethnicityMultiracial'],
            ['黑人', 'ethnicityEbony'],
            ['鲜嫩青年22+', 'ageYoung'],
            ['学生', 'subcultureStudent'],
            ['口交', 'doBlowjob'],
            ['深喉', 'doDeepThroat'],
            ['恋足', 'doFootFetish'],
            ['互动玩具', 'autoTagInteractiveToy'],
            ['自慰', 'doMasturbation'],
            ['肛交', 'doAnal'],
            ['潮吹', 'doSquirt'],
            ['狗式', 'doDoggyStyle'],
            ['Cosplay', 'doCosplay'],
            ['RolePlay', 'doRolePlay'],
        ]
        // 男主播专属标签放最前
        let head = []
        if (String(tid || '').indexOf('men') !== -1) {
            head = [
                ['情侣', 'sexGayCouples'],
                ['直男', 'orientationStraight'],
            ]
        }

        let ft = new FilterTitle()
        ft.name = '标签'
        let labels = []
        let seen = {}
        const all = head.concat(pairs)
        for (let i = 0; i < all.length; i++) {
            if (seen[all[i][1]]) {
                continue
            }
            seen[all[i][1]] = 1
            let fl = new FilterLabel()
            fl.name = all[i][0]
            fl.id = all[i][1]
            fl.key = 'tag'
            labels.push(fl)
        }
        ft.list = labels
        return [ft]
    }

    //MARK: - 网络与域名自愈

    curHost() {
        if (this._healedHost) {
            return this._healedHost
        }
        const h = this.hostOf(this.webSite)
        const i = h ? this._indexOfDomain(h) : -1
        return i === -1 ? scDomains[0] : this._domains()[i]
    }

    /**
     * 域名顺序：把「已经探明可用」的域名提到第一位。
     *
     * ⚠️ 这是 v4 修掉的核心性能问题：
     * 原版 `_healedHost` 只在 curHost()（请求头里的 Origin/Referer）用到，
     * `_domains()` 完全不理它 → 每次 apiGet 都还从 `scDomains[0]` 开始试。
     * 用户网络下第一条慢或不通时，**每一次请求都要先把第一条等死**，白等一遍。
     */
    _domains() {
        const base = this._domainOrder || scDomains
        const h = this._healedHost
        if (!h) {
            return base
        }
        let out = [h]
        for (let i = 0; i < base.length; i++) {
            if (base[i] !== h) {
                out.push(base[i])
            }
        }
        return out
    }

    _indexOfDomain(host) {
        const ds = this._domains()
        for (let i = 0; i < ds.length; i++) {
            if (this.hostOf(ds[i]) === host) {
                return i
            }
        }
        return -1
    }

    _orderDomains(host) {
        const ds = this._domains().slice()
        for (let i = 0; i < ds.length; i++) {
            if (this.hostOf(ds[i]) === host) {
                ds.splice(i, 1)
                ds.unshift('https://' + host)
                break
            }
        }
        this._domainOrder = ds
    }

    /**
     * 取一次接口数据。
     *
     * v4 起分三条路（依据 2026-09-28 实测：com/global 平时 0.5~0.8s，
     * 但会**偶发挂住 5~25 秒**；stripol 稳定但偏慢 1.2s）：
     *   ① 已有探明线路 → 单发一条（绝大多数情况，1 个请求搞定）
     *   ② 正在选路 → 等它出结果，再用选出的线路单发本路径
     *      （防止 searchVideo 那种并发调用各自竞速，把请求数翻三倍）
     *   ③ 线路未知 / 刚失效 → 三条**并行竞速**，谁先给出有效 JSON 用谁
     *
     * 原版是无条件串行 for 循环：第一条挂了就**一直等它挂完**（实测最长 25 秒），
     * 而且 `_healedHost` 不参与排序 → 每次请求都重来一遍。
     */
    async apiGet(path) {
        // ① 快路径
        if (this._healedHost) {
            const r = await this.get(this._healedHost + path)
            const json = scParseJsonData(r.data)
            if (json) {
                return { json: json, error: '' }
            }
            // 这条已经不行了（挂起超时 / 被限流 / 抖动），丢掉记录，重新选路
            this._healedHost = ''
        }

        // ② 已有一次选路在进行 → 等它，然后用选出的线路单发本路径
        if (this._raceTask) {
            await this._raceTask
            if (this._healedHost) {
                const r = await this.get(this._healedHost + path)
                const json = scParseJsonData(r.data)
                if (json) {
                    return { json: json, error: '' }
                }
                this._healedHost = ''
            }
            return await this.serialApi(path)
        }

        // ③ 发起一次竞速（用本路径，顺便拿到本路径的数据）
        //    注意：这一步必须是**同步**赋值，否则并发调用会各自开一次竞速
        let res = null
        this._raceTask = this.raceApi(path)
        try {
            res = await this._raceTask
        } finally {
            this._raceTask = null
        }
        if (res && res.json) {
            return res
        }
        // 竞速全失败 → 串行兜底一次，把真实失败原因带出来
        return await this.serialApi(path)
    }

    /**
     * 串行兜底：按当前顺序一条条试，第一条给出有效 JSON 的胜出并被记住。
     * 只在「竞速全失败」时用到（站点整个不通），此时失败原因更有参考价值。
     */
    async serialApi(path) {
        const ds = this._domains()
        let last = null
        for (let i = 0; i < ds.length; i++) {
            const r = await this.get(ds[i] + path)
            last = r
            const json = scParseJsonData(r.data)
            if (json) {
                this._healedHost = ds[i]
                return { json: json, error: '' }
            }
        }
        return { json: null, error: this.describeFailure(last) }
    }

    /**
     * 线路未知时：三条**并行**竞速，谁先返回有效 JSON 就用谁，并记住它。
     *
     * 这是本版最关键的提速点：把「等某个域名挂完 25 秒」变成「等最快那条 ~0.5 秒」。
     * 代价可控：只在「首次」或「原线路失效后」发生，多打 1~2 个请求；
     * 一旦确定线路，后续全部走 apiGet 的①，一个多余请求都没有。
     */
    async raceApi(path) {
        const ds = this._domains()
        if (!ds.length) {
            return { json: null, error: '没有可用线路' }
        }
        return await new Promise((resolve) => {
            let left = ds.length
            let last = null
            let done = false
            const finish = (res) => {
                if (!done) {
                    done = true
                    resolve(res)
                }
            }
            const onFail = (r) => {
                last = r
                left--
                if (left <= 0) {
                    finish({ json: null, error: this.describeFailure(last) })
                }
            }
            for (let i = 0; i < ds.length; i++) {
                const host = ds[i]
                this.get(host + path)
                    .then((r) => {
                        const json = scParseJsonData(r.data)
                        if (json) {
                            // 只有第一个成功的会走到 finish，但 _healedHost 可能被后到的覆盖，
                            // 这里加 done 判断，保证记下的是**真正胜出**的那条
                            if (!done) {
                                this._healedHost = host
                            }
                            finish({ json: json, error: '' })
                            return
                        }
                        onFail(r)
                    })
                    .catch((e) => {
                        onFail({ code: -1, data: null, error: e && e.message })
                    })
            }
        })
    }

    /**
     * 把失败原因翻译成人话（拿到的可能根本不是 JSON，而是 CF 挑战页 / 错误页）
     */
    describeFailure(r) {
        if (!r) {
            return '网络请求失败，请稍后重试'
        }
        const body = scAsText(r.data)
        if (body.indexOf('Just a moment') !== -1 || body.indexOf('cf-chl') !== -1 || body.indexOf('challenge-platform') !== -1) {
            return '被 Cloudflare 人机验证拦了（请求太密），等几分钟再试'
        }
        if (r.code === 403) {
            return '站点拒绝访问（HTTP 403），可能被风控封锁，换手机流量试试'
        }
        if (r.code === 429) {
            return '被限流了（HTTP 429），歇一会儿再试'
        }
        if (r.code === 408) {
            return '请求超时，检查网络后重试'
        }
        if (!r.code || r.code < 0) {
            return '三条线路都连不上（' + (r.error || '网络错误') + '）'
        }
        return '接口返回异常（HTTP ' + r.code + '）'
    }

    /**
     * 发一个 GET。
     * v4 起显式传 scTimeoutMs（两种单位读法下都安全，见该常量说明）。
     * 原版不传 → 某条线路「连上但不响应」时要干等 App 默认值（毫秒读法下 30 秒）。
     */
    async get(url, refererOrigin) {
        const origin = refererOrigin || scOriginOf(url) || this.curHost()
        try {
            const p = await req(url, {
                headers: {
                    'User-Agent': scUa,
                    Accept: 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    Origin: origin,
                    Referer: origin + '/',
                },
                sendTimeout: scTimeoutMs,
                receiveTimeout: scTimeoutMs,
            })
            return { code: p.code, data: p.data, error: p.error || '' }
        } catch (e) {
            return { code: -1, data: null, error: e.message }
        }
    }

    readFilters(arr) {
        const out = {}
        const list = arr || []
        for (let i = 0; i < list.length; i++) {
            const f = list[i] || {}
            const key = String(f.key || '')
            if (!key) {
                continue
            }
            const v = f.id
            out[key] = v === undefined || v === null ? '' : String(v)
        }
        return out
    }

    hostOf(u) {
        const m = String(u || '').match(/^https?:\/\/([^\/]+)/i)
        return m ? m[1] : ''
    }

    removeTrailingSlash(str) {
        const s = String(str || '')
        return s.endsWith('/') ? s.slice(0, -1) : s
    }
}

var stripchat2026 = new scStripchatClass()
