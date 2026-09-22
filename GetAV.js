// ignore
//@name:[禁] GetAV
//@version:1
//@webSite:https://getav.net
//@remark:GetAV（蝴蝶影视专线）JAV 库，5 域名自愈 + 排序/字幕/画质筛选。停用可在源列表里删掉。
//@type:100
//@instance:getav2026
//@isAV:1
//@order: E
import { } from '../../core/uzVideo.js'
import { } from '../../core/uzHome.js'
import { } from '../../core/uz3lib.js'
import { } from '../../core/uzUtils.js'
// ignore

/**
 * GetAV 官方发布页（getav.info）公布的 5 个入口，顺序即优先级。
 * 任一域名可用就会被记住，后续请求都用它；全部失败才会重新探测。
 */
const kDomains = [
    'https://getav.net',
    'https://getav.me',
    'https://getav.live',
    'https://getav.co',
    'https://getav.top',
]

/** 封面 / 头像 / 片源所在的静态站 */
const kStaticHost = 'https://static.worldstatic.com'

/** 演员大全默认取哪个性别：2=女优 1=男优（改这里即可） */
const kStarGender = '2'

/** 演员/类型/片商/番号 二级列表每页取多少条 */
const kFolderLimit = 100

const kTgGroup = 'https://t.me/tvshare23'

const kUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

class getavClass extends WebApiBase {
    constructor() {
        super()
        this.kHeaders = {
            'User-Agent': kUa,
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Accept: 'application/json, text/plain, */*',
        }
        // 自愈后的可用域名，仅存活于本次运行
        this._healedHost = ''
    }

    //MARK: - 首页分类

    /**
     * 获取一级分类
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

            // 若 App 里配的域名正好是官方域名之一，把它提到最前，省一次探测
            const cfgHost = this.hostOf(this.webSite)
            if (cfgHost) {
                this._orderDomains(cfgHost)
            }

            const raw = [
                ['🔥 最近更新', 'api@@latest'],
                ['📈 热门影片', 'api@@hot'],
                ['✨ 新片上市', 'api@@new-releases'],
                ['🔞 无码影片', 'api@@uncensored'],
                ['🈵 有码影片', 'api@@censored'],
                ['🔤 字幕专区', 'api@@subtitle'],
                ['💎 4K 超高清', 'api@@4k'],
                ['📂 类型大全', 'folder@@genres'],
                ['📂 演员大全', 'folder@@stars'],
                ['📂 片商大全', 'folder@@studios'],
                ['📂 番号系列', 'folder@@codes'],
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
     * 获取二级分类 / 筛选列表
     * @param {UZArgs} args
     * @returns {Promise<RepVideoSubclassList>}
     */
    async getSubclassList(args) {
        let backData = new RepVideoSubclassList()
        try {
            const tid = String(args.url || '')
            let sub = new VideoSubclass()
            sub.class = []
            sub.filter = []

            if (tid.indexOf('folder@@') === 0) {
                // 类型 / 演员 / 片商 / 番号：二级列表本身就是「分类」
                sub.class = await this.folderSubclasses(tid.replace('folder@@', ''))
            } else {
                // 视频分类：给筛选面板（排序 / 字幕 / 画质）
                sub.filter = this.buildFilters()
            }
            backData.data = sub
        } catch (error) {
            backData.error = '获取筛选项失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 列表

    /**
     * 获取分类视频列表（无筛选路径）
     * @param {UZArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async getVideoList(args) {
        let backData = new RepVideoList()
        try {
            const tid = String(args.url || '')
            const page = args.page || 1
            const r = await this.apiGet(this.categoryPath(tid, page, {}))
            backData.error = r.error
            backData.data = this.parseMovies(r.json)
            backData.total = this.parseTotal(r.json)
        } catch (error) {
            backData.error = '获取列表失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    /**
     * 获取二级分类 / 筛选后的视频列表
     * @param {UZSubclassVideoListArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async getSubclassVideoList(args) {
        let backData = new RepVideoList()
        try {
            const mainId = String(args.mainClassId || args.url || '')
            const subId = String(args.subclassId || '')
            const page = args.page || 1
            const filters = this.readFilters(args.filter)

            let path = ''
            if (mainId.indexOf('folder@@') === 0) {
                path = this.folderMoviesPath(mainId.replace('folder@@', ''), subId, page, filters)
            } else {
                path = this.categoryPath(mainId, page, filters)
            }

            const r = await this.apiGet(path)
            backData.error = r.error
            backData.data = this.parseMovies(r.json)
            backData.total = this.parseTotal(r.json)
        } catch (error) {
            backData.error = '获取筛选列表失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 详情

    /**
     * 获取视频详情
     * @param {UZArgs} args
     * @returns {Promise<RepVideoDetail>}
     */
    async getVideoDetail(args) {
        let backData = new RepVideoDetail()
        try {
            const code = String(args.url || '')
                .trim()
                .toLowerCase()
            const r = await this.apiGet('/api/movies/' + encodeURIComponent(code))
            backData.error = r.error

            const data = (r.json && r.json.data) || {}
            if (!data || !data.id) {
                if (!backData.error) {
                    backData.error = '没取到影片信息（可能是番号 ' + code + ' 已下架）'
                }
                return JSON.stringify(backData)
            }

            const title = data.title || code.toUpperCase()
            const dur = this.formatSeconds(data.videoLength)

            const genreNames = []
            const gs = data.genres || []
            for (let i = 0; i < gs.length; i++) {
                const g = gs[i] || {}
                const nm = this.cleanText(g.name)
                if (nm && genreNames.indexOf(nm) === -1) {
                    genreNames.push(nm)
                }
            }

            const actorNames = []
            const ss = data.stars || []
            for (let i = 0; i < ss.length; i++) {
                const s = ss[i] || {}
                const nm = this.cleanText(s.name)
                if (nm) {
                    actorNames.push(nm)
                }
            }

            const playLines = this.buildPlayLines(data)
            const dateStr = String(data.date || '')
            const fullContent =
                '【🔥 官方交流群: ' +
                kTgGroup +
                '】\n【当前线路: ' +
                this.curHost() +
                '】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                '番号: ' +
                code.toUpperCase() +
                '\n片名: ' +
                title +
                '\n时长: ' +
                (dur || '未知') +
                '\n发行: ' +
                dateStr.slice(0, 10) +
                '\n简介: ' +
                this.cleanText(data.description || data.plot || title)

            let detModel = new VideoDetail()
            detModel.vod_id = code
            detModel.vod_name = title
            detModel.vod_pic = this.absPic(data.localImg || data.img)
            detModel.type_name = genreNames.length ? genreNames.join(' / ') : 'JAV'
            detModel.vod_year = dateStr.slice(0, 4)
            detModel.vod_area = '日本'
            detModel.vod_remarks = dur ? '蝴蝶影视 | ' + dur : '蝴蝶影视'
            detModel.topRightRemarks = dur || ''
            detModel.vod_actor = actorNames.length ? actorNames.join(', ') : '🦋 TG群: @tvshare23'
            detModel.vod_director = '🦋 蝴蝶影视'
            detModel.vod_content = fullContent
            detModel.vod_play_from = '蝴蝶影视专线'
            detModel.vod_play_url = playLines.length
                ? playLines.map((x) => x[0] + '$' + x[1]).join('#')
                : '暂无可用线路$http://127.0.0.1'
            backData.data = detModel
        } catch (error) {
            backData.error = '获取视频详情失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 播放

    /**
     * 获取播放地址
     * @param {UZArgs} args
     * @returns {Promise<RepVideoPlayUrl>}
     */
    async getVideoPlayUrl(args) {
        let backData = new RepVideoPlayUrl()
        try {
            const playUrl = String(args.url || '').trim()
            if (!/^https?:\/\//i.test(playUrl)) {
                backData.error = '播放地址无效'
                return JSON.stringify(backData)
            }
            backData.headers = {
                'User-Agent': kUa,
                Referer: this.curHost() + '/',
                Origin: this.curHost(),
            }
            backData.data = playUrl
        } catch (error) {
            backData.error = '获取播放地址失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 搜索

    /**
     * 搜索视频
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
            const page = args.page || 1
            const path =
                '/api/movies?q=' +
                encodeURIComponent(kw) +
                '&sortBy=latest&limit=40&page=' +
                page +
                '&locale=zh'
            const r = await this.apiGet(path)
            backData.error = r.error
            backData.data = this.parseMovies(r.json)
            backData.total = this.parseTotal(r.json)
        } catch (error) {
            backData.error = '搜索失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 路径构造

    categoryPath(tid, page, filters) {
        const cat = tid.indexOf('api@@') === 0 ? tid.replace('api@@', '') : 'latest'
        const p = ['category=' + cat, 'page=' + page, 'limit=40', 'locale=zh']
        p.push('sortBy=' + (filters.sortBy || 'latest'))
        if (filters.subtitles === 'true') {
            p.push('subtitles=true')
        }
        if (filters.resolution === '4k') {
            p.push('resolution=4k')
        }
        return '/api/movies?' + p.join('&')
    }

    folderMoviesPath(folderType, subId, page, filters) {
        const p = ['page=' + page, 'limit=40', 'locale=zh', 'sortBy=' + (filters.sortBy || 'latest')]
        if (filters.subtitles === 'true') {
            p.push('subtitles=true')
        }
        if (filters.resolution === '4k') {
            p.push('resolution=4k')
        }
        // 目录类型要同时兼容单数（star）和复数（stars），
        // 因为二级分类里的前缀来自 type_id（folder@@stars），而 py 里用的是 subfolder@@star@@。
        const t = String(folderType || '').replace(/s$/, '')
        if (t === 'star') {
            p.push('starId=' + encodeURIComponent(subId))
        } else if (t === 'genre') {
            p.push('genreId=' + encodeURIComponent(subId))
        } else if (t === 'studio') {
            p.push('studioId=' + encodeURIComponent(subId))
        } else if (t === 'code') {
            p.push('code=' + encodeURIComponent(subId))
        }
        return '/api/movies?' + p.join('&')
    }

    /**
     * 类型 / 演员 / 片商 / 番号 的二级列表（作为 VideoClass 返回）
     * @returns {Promise<VideoClass[]>}
     */
    async folderSubclasses(folderType) {
        let path = ''
        if (folderType === 'genres') {
            path = '/api/genres?limit=' + kFolderLimit + '&sort=popular&locale=zh-CN'
        } else if (folderType === 'studios') {
            path = '/api/studios?limit=' + kFolderLimit + '&sort=popular&locale=zh-CN'
        } else if (folderType === 'codes') {
            path = '/api/codes?limit=' + kFolderLimit + '&sort=popular&locale=zh-CN'
        } else if (folderType === 'stars') {
            path =
                '/api/stars?page=1&limit=' +
                kFolderLimit +
                '&sort=popular&locale=zh&gender=' +
                kStarGender
        } else {
            return []
        }

        const r = await this.apiGet(path)
        const data = (r.json && r.json.data) || {}
        let items = []
        if (folderType === 'genres') {
            items = data.genres || []
        } else if (folderType === 'studios') {
            items = data.studios || []
        } else if (folderType === 'codes') {
            items = data.codes || []
        } else if (folderType === 'stars') {
            items = data.stars || (Array.isArray(data) ? data : [])
        }

        let list = []
        for (let i = 0; i < items.length; i++) {
            const it = items[i] || {}
            const id = String(it.id === undefined || it.id === null ? '' : it.id).trim()
            if (!id) {
                continue
            }
            let name = ''
            if (folderType === 'codes') {
                name = String(it.name || it.code || id).trim().toUpperCase()
            } else {
                name = this.cleanText(it.name || it.originalName || it.nameJp || id)
            }
            if (!name) {
                continue
            }
            const count = it.movieCount || it.movie_count || ''
            let videoClass = new VideoClass()
            videoClass.type_id = id
            videoClass.type_name = count ? name + ' (' + count + '部)' : name
            videoClass.hasSubclass = false
            list.push(videoClass)
        }
        return list
    }

    //MARK: - 解析

    parseMovies(json) {
        const data = (json && json.data) || {}
        const movies = data.movies || []
        let out = []
        for (let i = 0; i < movies.length; i++) {
            const m = movies[i] || {}
            const cid = String(m.id === undefined || m.id === null ? '' : m.id)
                .trim()
                .toLowerCase()
            if (!cid || /^\d+$/.test(cid)) {
                continue
            }
            const dur = this.formatSeconds(m.videoLength)
            out.push({
                vod_id: cid,
                vod_name: this.cleanText(m.title) || cid.toUpperCase(),
                vod_pic: this.absPic(m.localImg || m.img),
                vod_remarks: dur ? '蝴蝶影视 | ' + dur : '蝴蝶影视',
            })
        }
        return out
    }

    parseTotal(json) {
        const data = (json && json.data) || {}
        const t = data.total
        return typeof t === 'number' && t > 0 ? t : 9999
    }

    buildPlayLines(data) {
        const labelMap = {
            raw_1080p: '正片 1080P',
            raw_720p: '高清 720P',
            raw_480p: '标清 480P',
            raw_240p: '流畅 240P',
        }
        // 接口返回的 videoSources 是按 priority 排的（1080p/480p/720p 混着），
        // 这里按画质从高到低重排，"精彩预告"永远放最后。
        const rankMap = {
            raw_1080p: 40,
            raw_720p: 30,
            raw_480p: 20,
            raw_240p: 10,
        }
        let items = []
        const seen = {}
        const vs = data.videoSources || []
        for (let i = 0; i < vs.length; i++) {
            const v = vs[i] || {}
            const url = String(v.url || '').trim()
            if (!url || seen[url]) {
                continue
            }
            seen[url] = 1
            const t = String(v.type || '')
            items.push({ line: [labelMap[t] || t || '默认线路', url], rank: rankMap[t] || 0 })
        }
        if (!items.length) {
            const fbs = [
                ['超清 4K', data.localM3u8Path4k, 50],
                ['高清 1080P', data.localM3u8Path, 40],
                ['无码专线', data.localM3u8PathUc, 35],
                ['中文字幕专线', data.localM3u8PathCn, 33],
            ]
            for (let i = 0; i < fbs.length; i++) {
                const url = String(fbs[i][1] || '').trim()
                if (url && !seen[url]) {
                    seen[url] = 1
                    items.push({ line: [fbs[i][0], url], rank: fbs[i][2] })
                }
            }
        }
        items.sort((a, b) => b.rank - a.rank)
        let lines = items.map((x) => x.line)
        const pv = String(data.previewVideoUrl || '').trim()
        if (pv) {
            lines.push(['精彩预告', /^https?:\/\//i.test(pv) ? pv : kStaticHost + pv])
        }
        return lines
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

    buildFilters() {
        const groups = [
            [
                '排序',
                'sortBy',
                [
                    ['最新', 'latest'],
                    ['最热', 'popular'],
                    ['评分', 'rating'],
                    ['时长', 'duration'],
                ],
            ],
            [
                '字幕',
                'subtitles',
                [
                    ['全部', ''],
                    ['中文字幕', 'true'],
                ],
            ],
            [
                '画质',
                'resolution',
                [
                    ['全部', ''],
                    ['4K超高清', '4k'],
                ],
            ],
        ]
        let out = []
        for (let i = 0; i < groups.length; i++) {
            let ft = new FilterTitle()
            ft.name = groups[i][0]
            let labels = []
            const vals = groups[i][2]
            for (let j = 0; j < vals.length; j++) {
                let fl = new FilterLabel()
                fl.name = vals[j][0]
                fl.id = vals[j][1]
                fl.key = groups[i][1]
                labels.push(fl)
            }
            ft.list = labels
            out.push(ft)
        }
        return out
    }

    //MARK: - 网络与域名自愈

    curHost() {
        if (this._healedHost) {
            return this._healedHost
        }
        const h = this.hostOf(this.webSite)
        if (h && this._indexOfDomain(h) !== -1) {
            return this._domainAt(this._indexOfDomain(h))
        }
        return kDomains[0]
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

    _domainAt(i) {
        return this._domains()[i]
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
            return { json: null, error: '所有官方域名都连不上，稍后再试（可到 https://getav.info 看最新地址；若一直不通，试着把 DNS 换成 8.8.8.8 / 1.1.1.1）' }
        }
        let r = await this.get(host + path)
        if (r.code !== 200 || !r.data) {
            // 当前域名挂了，重探一次
            this._healedHost = ''
            const host2 = await this.ensureDomain()
            if (host2 && host2 !== host) {
                r = await this.get(host2 + path)
            }
        }
        const json = this.parseJson(r.data)
        if (json) {
            return { json: json, error: '' }
        }
        // 站点在 Cloudflare 后面，请求太密会被丢一个 JS 挑战页（403 +「Just a moment...」）
        const guess = this.describeFailure(r)
        return { json: null, error: guess || r.error || '接口返回异常（HTTP ' + r.code + '）' }
    }

    /**
     * 找到第一个能返回正常 JSON 的域名
     * @returns {Promise<string>}
     */
    async ensureDomain() {
        if (this._healedHost) {
            return this._healedHost
        }
        const ds = this._domains()
        // 5 条线路各试 2 轮：这些站偶尔会抖一下或丢一次 CF 挑战，只试一次容易误判成「全挂」
        for (let round = 0; round < 2; round++) {
            for (let i = 0; i < ds.length; i++) {
                const r = await this.get(ds[i] + '/api/movies?category=latest&limit=1&page=1&locale=zh')
                const json = this.parseJson(r.data)
                if (json && json.data && json.data.movies) {
                    this._healedHost = ds[i]
                    return ds[i]
                }
            }
        }
        return ''
    }

    async get(url) {
        try {
            const p = await req(url, {
                headers: {
                    ...this.kHeaders,
                    Referer: this.curHostOrWebSite() + '/',
                },
                sendTimeout: 12000,
                receiveTimeout: 15000,
            })
            return { code: p.code, data: p.data || '', error: p.error || '' }
        } catch (e) {
            return { code: -1, data: '', error: e.message }
        }
    }

    curHostOrWebSite() {
        if (this._healedHost) {
            return this._healedHost
        }
        const h = this.hostOf(this.webSite)
        return h ? 'https://' + h : kDomains[0]
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

    /**
     * 把「拿到的不是 JSON」这种失败翻译成人话，方便排查
     */
    describeFailure(r) {
        const body = String(r.data || '')
        if (body.indexOf('Just a moment') !== -1 || body.indexOf('cf-chl') !== -1 || body.indexOf('challenge-platform') !== -1) {
            return '被 Cloudflare 风控拦了（点得太快），等几分钟再试或换个分类'
        }
        if (body.indexOf('Edge IP Restricted') !== -1) {
            return 'CDN 边缘节点异常（Cloudflare 1034），稍后重试或切换网络'
        }
        if (body.indexOf('error code: 1034') !== -1) {
            return 'CDN 边缘节点异常（Cloudflare 1034），稍后重试或切换网络'
        }
        if (r.code === 0) {
            return '连不上（域名被墙或 DNS 被污染），可在路由器把 DNS 换成 8.8.8.8 / 1.1.1.1'
        }
        if (r.code === 403 || r.code === 429) {
            return '被站点限流了（HTTP ' + r.code + '），歇一会儿再试'
        }
        return ''
    }

    //MARK: - 工具

    absPic(p) {
        const s = String(p || '').trim()
        if (!s) {
            return ''
        }
        if (/^https?:\/\//i.test(s)) {
            return s
        }
        if (s.indexOf('//') === 0) {
            return 'https:' + s
        }
        return kStaticHost + (s.indexOf('/') === 0 ? s : '/' + s)
    }

    cleanText(raw) {
        const t = String(raw === undefined || raw === null ? '' : raw).replace(/<[^>]+>/g, '')
        return this.unescape(t).replace(/[\r\n\t\s]+/g, ' ').trim()
    }

    formatSeconds(secs) {
        const s = parseInt(secs, 10)
        if (!s || s <= 0) {
            return ''
        }
        const h = Math.floor(s / 3600)
        const m = Math.floor((s % 3600) / 60)
        const ss = s % 60
        const pad = (n) => (n < 10 ? '0' + n : '' + n)
        return h > 0 ? pad(h) + ':' + pad(m) + ':' + pad(ss) : pad(m) + ':' + pad(ss)
    }

    hostOf(u) {
        const m = String(u || '').match(/^https?:\/\/([^\/]+)/i)
        return m ? m[1] : ''
    }

    removeTrailingSlash(str) {
        const s = String(str || '')
        return s.endsWith('/') ? s.slice(0, -1) : s
    }

    unescape(s) {
        if (!s) {
            return ''
        }
        return String(s)
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)))
            .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/&amp;/g, '&')
    }
}

var getav2026 = new getavClass()
