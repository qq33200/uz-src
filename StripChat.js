// ignore
//@name:[禁] StripChat
//@version:2
//@webSite:https://zh.stripchat.com
//@remark:StripChat 直播，三域名自愈，按国家/标签筛选。播放直连官方 HLS，不需要代理。
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
const kDomains = ['https://zh.stripchat.com', 'https://zh.stripchat.global', 'https://zh.stripol.com']

/**
 * 拉流用的边缘节点，按顺序试。
 * 与原 py 的 playerContent 完全一致：先 sacfedge，失败再降级到 doppiocdn.org。
 */
const kEdgeMasters = [
    'https://edge-hls.sacfedge.com/hls/{id}/master/{id}_auto.m3u8?playlistType=lowLatency',
    'https://edge-hls.doppiocdn.org/hls/{id}/master/{id}_auto.m3u8?playlistType=lowLatency',
]

/** 每页多少个主播 */
const kPageSize = 60

/** 搜索时每个分类各取多少条 */
const kSearchLimit = 30

/**
 * 弹幕开关。默认关闭。
 * uzVideo 只在进入播放时调用一次 getVideoPlayUrl，拿到的只能是「那一刻」的聊天记录快照，
 * 之后不会再拉新消息，所以它更像是「进房时把最近的聊天刷一遍」而不是真正的实时弹幕。
 * 想体验就把下面改成 true。
 */
const kEnableDanmu = false

/** 快照弹幕的间隔秒数（把最近若干条聊天按这个间隔铺开） */
const kDanmuInterval = 2

const kUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0'

/**
 * 把 req 的返回值安全地解析成 JSON 对象。
 *
 * ⚠️ 关键：uz 的 `req` 会按响应头 content-type 自动决定 `data` 的类型 ——
 * content-type 是 application/json 时，`data` 已经是**解析好的对象**；
 * 是 text/* 或无 content-type 时 `data` 才是字符串。
 * 所以**绝对不能无条件 `JSON.parse(pro.data)`**，那会在真机上直接抛 "Unexpected token o"。
 * 官方扩展也是这么兼容的，见 panTools2.js: `typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data`
 */
function parseJsonData(d) {
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

/** 把 req 的返回值安全地取成文本（m3u8 / HTML 用） */
function asText(d) {
    return typeof d === 'string' ? d : ''
}

/** 从 URL 里取「协议+域名」 */
function originOf(url) {
    const m = String(url || '').match(/^(https?:\/\/[^\/]+)/i)
    return m ? m[1] : ''
}

class stripchatClass extends WebApiBase {
    constructor() {
        super()
        // 自愈到可用域名后记在这里，后续请求都用它
        this._healedHost = ''
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
            const offset = kPageSize * (page > 0 ? page - 1 : 0)
            let path =
                '/api/front/models?improveTs=false&removeShows=false&limit=' +
                kPageSize +
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
                'User-Agent': kUa,
                Origin: this.curHost(),
                Referer: this.curHost() + '/',
            }
            backData.headers = headers

            let variants = []
            for (let i = 0; i < kEdgeMasters.length; i++) {
                const master = kEdgeMasters[i].split('{id}').join(sid)
                const r = await this.get(master)
                const text = asText(r.data)
                if (r.code === 200 && text.indexOf('#EXT-X-STREAM-INF') !== -1) {
                    variants = this.parseVariants(text, master)
                    if (variants.length) {
                        break
                    }
                }
            }

            if (!variants.length) {
                backData.error = '拉不到直播清单，可能已下播或该地区被墙'
                return JSON.stringify(backData)
            }

            let urls = []
            for (let i = 0; i < variants.length; i++) {
                urls.push({ name: variants[i].name, url: variants[i].url, headers: headers })
            }
            backData.urls = urls

            if (kEnableDanmu) {
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
                            kSearchLimit +
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
            out.push({ content: item, time: i * kDanmuInterval })
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
        return i === -1 ? kDomains[0] : this._domains()[i]
    }

    _domains() {
        return this._domainOrder || kDomains
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
     * 对齐原 py 的 _request_with_failover：
     * 直接在各个域名上请求**目标路径**，谁先返回可用 JSON 就用谁，并记住这个域名。
     * 不再做额外的「探测请求」——探测会多打一次接口，反而更容易触发风控。
     */
    async apiGet(path) {
        const ds = this._domains()
        let last = null
        for (let i = 0; i < ds.length; i++) {
            const r = await this.get(ds[i] + path)
            last = r
            const json = parseJsonData(r.data)
            if (json) {
                this._healedHost = ds[i]
                return { json: json, error: '' }
            }
        }
        return { json: null, error: this.describeFailure(last) }
    }

    /**
     * 把失败原因翻译成人话（拿到的可能根本不是 JSON，而是 CF 挑战页 / 错误页）
     */
    describeFailure(r) {
        if (!r) {
            return '网络请求失败，请稍后重试'
        }
        const body = asText(r.data)
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
     * 注意：uz 的 sendTimeout / receiveTimeout 单位是「秒」（官方模板里写的是 40），
     * 这里不传，交给 App 用默认值，避免单位理解错导致「永不超时」。
     */
    async get(url, refererOrigin) {
        const origin = refererOrigin || originOf(url) || this.curHost()
        try {
            const p = await req(url, {
                headers: {
                    'User-Agent': kUa,
                    Accept: 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    Origin: origin,
                    Referer: origin + '/',
                },
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

var stripchat2026 = new stripchatClass()
