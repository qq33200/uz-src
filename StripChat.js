// ignore
//@name:[禁] StripChat
//@version:1
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

/** 拉流用的边缘节点，按顺序试 */
const kEdgeMasters = [
    'https://edge-hls.sacfedge.com/hls/{id}/master/{id}_auto.m3u8?playlistType=lowLatency',
    'https://edge-hls.doppiocdn.media/hls/{id}/master/{id}_auto.m3u8?playlistType=lowLatency',
    'https://edge-hls.doppiocdn.com/hls/{id}/master/{id}_auto.m3u8?playlistType=lowLatency',
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

class stripchatClass extends WebApiBase {
    constructor() {
        super()
        this.kHeaders = {
            'User-Agent': kUa,
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Accept: 'application/json, text/plain, */*',
        }
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
            detModel.vod_play_from = 'StripChat 直播'
            detModel.vod_play_url = '自动（最高画质）$' + uid
            backData.data = detModel
        } catch (error) {
            backData.error = '获取详情失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 播放

    /**
     * 拿 master 清单 → 展开成各画质的 variant 地址。
     * master 里的 #EXT-X-MOUFLON:PSCH / variant 里的 #EXT-X-MOUFLON:EXT-REF 都是附加标签，
     * 播放器按非标准标签忽略即可；真正的分片地址是明文的，所以不需要任何代理。
     * @param {UZArgs} args
     * @returns {Promise<RepVideoPlayUrl>}
     */
    async getVideoPlayUrl(args) {
        let backData = new RepVideoPlayUrl()
        try {
            const raw = String(args.url || '').trim()
            const sid = raw.split('_').pop()
            if (!/^\d+$/.test(sid)) {
                backData.error = '主播 ID 解析失败'
                return JSON.stringify(backData)
            }

            const headers = {
                'User-Agent': kUa,
                Origin: 'https://zh.stripchat.com',
                Referer: 'https://zh.stripchat.com/',
            }
            backData.headers = headers

            let variants = []
            for (let i = 0; i < kEdgeMasters.length && !variants.length; i++) {
                const master = kEdgeMasters[i].split('{id}').join(sid)
                const r = await this.get(master, 'https://zh.stripchat.com/')
                if (r.code !== 200 || !r.data) {
                    continue
                }
                variants = this.parseVariants(r.data, master)
            }

            if (!variants.length) {
                backData.error = '拉不到直播清单，可能已下播或该地区被墙'
                return JSON.stringify(backData)
            }

            // 逐个校验，把「真直播」和「广告循环」区分开（最多查 3 条，够用就停）
            let live = []
            let all = []
            for (let i = 0; i < variants.length && i < 3; i++) {
                const v = variants[i]
                const vr = await this.get(v.url, 'https://zh.stripchat.com/')
                const ok = vr.code === 200 && vr.data && vr.data.indexOf('#EXTINF') !== -1
                const isAd = ok && (vr.data.indexOf('#EXT-X-MOUFLON-ADVERT') !== -1 || vr.data.indexOf('#EXT-X-ENDLIST') !== -1)
                const item = {
                    name: v.name + (ok && !isAd ? '' : ' ⚠未开播'),
                    url: v.url,
                    headers: headers,
                }
                all.push(item)
                if (ok && !isAd) {
                    live.push(item)
                    if (live.length >= 2) {
                        break
                    }
                }
            }
            // 没查到的剩余画质也带上，让用户自己挑
            for (let i = 0; i < variants.length; i++) {
                let dup = false
                for (let j = 0; j < all.length; j++) {
                    if (all[j].url === variants[i].url) {
                        dup = true
                        break
                    }
                }
                if (!dup) {
                    all.push({ name: variants[i].name, url: variants[i].url, headers: headers })
                }
            }

            backData.urls = live.length ? live : all
            if (!live.length) {
                backData.error = '当前只拿到广告循环（门票房或未公开直播），换个 🔴 免费房试试'
            }

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
        return h ? 'https://' + h : kDomains[0]
    }

    _domains() {
        return this._domainOrder || kDomains
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

    async apiGet(path) {
        const host = await this.ensureDomain()
        if (!host) {
            return { json: null, error: '三条官方线路都连不上，请检查网络后重试' }
        }
        let r = await this.get(host + path)
        if (r.code !== 200 || !r.data) {
            this._healedHost = ''
            const host2 = await this.ensureDomain()
            if (host2 && host2 !== host) {
                r = await this.get(host2 + path)
            }
        }
        const json = this.parseJson(r.data)
        return { json: json, error: json ? '' : r.error || '接口返回异常（HTTP ' + r.code + '）' }
    }

    async ensureDomain() {
        if (this._healedHost) {
            return this._healedHost
        }
        const ds = this._domains()
        for (let i = 0; i < ds.length; i++) {
            const r = await this.get(
                ds[i] +
                    '/api/front/models?improveTs=false&removeShows=false&limit=1&offset=0&primaryTag=girls' +
                    '&sortBy=stripRanking&rcmGrp=A&rbCnGr=true&prxCnGr=false&nic=false'
            )
            const json = this.parseJson(r.data)
            if (json && json.models) {
                this._healedHost = ds[i]
                return ds[i]
            }
        }
        return ''
    }

    async get(url, referer) {
        try {
            const p = await req(url, {
                headers: {
                    ...this.kHeaders,
                    Referer: referer || this.curHost() + '/',
                    Origin: this.curHost(),
                },
                sendTimeout: 12000,
                receiveTimeout: 15000,
            })
            return { code: p.code, data: p.data || '', error: p.error || '' }
        } catch (e) {
            return { code: -1, data: '', error: e.message }
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

    parseJson(text) {
        if (!text) {
            return null
        }
        try {
            return JSON.parse(text)
        } catch (e) {
            return null
        }
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
