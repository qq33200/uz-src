// ignore
//@name:[禁] GetAV
//@version:4
//@webSite:https://getav.top
//@remark:GetAV（蝴蝶影视专线）JAV 库，5 域名自愈 + 排序/字幕/画质筛选。停用可在源列表里删掉。；v4 提速：修掉「已探明的可用域名没参与排序」导致每次请求都从不通的域名重新试（实测每请求白等 43 秒）的问题——改为并行选路 + 请求加 10 秒超时，并按实测把可用域名排在前面
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
 * GetAV 官方发布页（getav.info）公布的 5 个入口。
 *
 * 🔴 顺序不是随便排的，是 2026-09-30 实测结果（详见下方各条注释）：
 *   getav.top   0.80~2.23s  ✅ 最快
 *   getav.live  0.97~1.92s  ✅
 *   getav.co    1.03~2.58s  ✅
 *   getav.net   0.22s 即被 RST（ECONNRESET），拿不到任何响应
 *   getav.me    **42 秒连接超时**：DNS 解析到 199.59.148.246（污染/停放 IP 段），
 *               国内连接是黑洞 —— 实测每次都干等到超时，一次都没成功过
 *
 * ⚠️ 曾经的问题：原版把 getav.net / getav.me 排在第 1、2 位，而上面的取出逻辑是
 *   「从第一条开始串行试」，于是**每一次** API 请求（翻页、进详情、搜索、二级分类）
 *   都要先白等 0.22s + 42s 才能轮到可用的域名 ≈ 43 秒/请求。
 *   这就是「GetAV 访问很慢」的真正原因，不是网络问题。
 *
 * 现在：① 实测可用的排前面、黑洞的降到末尾兜底；
 *       ② 换域名时并行竞速，不再串行等超时；
 *       ③ 选定后记住（_healedHost），后续请求单发直达。
 *   保留全部 5 个不删 —— 官方入口会变，留着当兜底；就算全挂也有明确报错指引。
 */
const gaDomains = [
    'https://getav.top',
    'https://getav.live',
    'https://getav.co',
    'https://getav.net',
    'https://getav.me',
]

/**
 * 单次请求超时（毫秒）。
 *
 * ⚠️ uz 的 `sendTimeout` / `receiveTimeout` 单位没有权威文档：读作毫秒时默认值 30000=30 秒，
 * 读作秒时则几乎等于不超时。**唯一安全的取法是「两种读法下都不至于把正常请求掐掉」**，
 * 所以取 10 秒 —— 正常一次请求约 1 秒，10 秒足够宽裕；而遇到 getav.me 那种黑洞时，
 * 最坏也只是等 10 秒，不会像原来那样干等 42 秒（真机上 TCP 层超时可能更久）。
 */
const gaTimeoutMs = 10000

/** 封面 / 头像 / 片源所在的静态站 */
const gaStaticHost = 'https://static.worldstatic.com'

/** 演员大全默认取哪个性别：2=女优 1=男优（改这里即可） */
const gaStarGender = '2'

/** 演员/类型/片商/番号 二级列表每页取多少条 */
const gaFolderLimit = 100

const gaTgGroup = 'https://t.me/tvshare23'

const gaUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/**
 * 把 req 的返回值安全地解析成 JSON 对象。
 *
 * ⚠️ 关键：uz 的 `req` 会按响应头 content-type 自动决定 `data` 的类型 ——
 * content-type 是 application/json 时，`data` 已经是**解析好的对象**；
 * 是 text/* 或无 content-type 时 `data` 才是字符串。
 * 所以**绝对不能无条件 `JSON.parse(pro.data)`**，那会在真机上直接抛 "Unexpected token o"。
 * 官方扩展也是这么兼容的，见 panTools2.js: `typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data`
 */
function gaParseJsonData(d) {
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
    if (typeof d === 'object' && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d)) {
        return d
    }
    return null
}

/**
 * 把 req 的返回值安全地取成文本（HTML / m3u8 用）。
 *
 * 除了字符串，也要能吃二进制 —— uz 的 `req` 按响应头 content-type 决定 `data` 类型，
 * 若站点在 Cloudflare 拦截页上没给 text/*，拿到的就是 ArrayBuffer。
 * 那时这里若直接返回 ''，下面 describeFailure 的「被 Cloudflare 拦了」判断会一起失效，
 * 用户只能看到一个含糊的「接口返回异常」。
 */
function gaAsText(d) {
    if (typeof d === 'string') {
        return d
    }
    try {
        if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) {
            const u8 = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
            let s = ''
            for (let i = 0; i < u8.length; i++) {
                s += String.fromCharCode(u8[i])
            }
            try {
                return decodeURIComponent(escape(s))
            } catch (e2) {
                // 不是合法 UTF-8：退回逐字节字符串。诊断用的关键词（"Just a moment" 等）
                // 都是 ASCII，这样照样能匹配上，总比返回空字符串强。
                return s
            }
        }
    } catch (e) {
        return ''
    }
    return ''
}

/** 从 URL 里取「协议+域名」 */
function gaOriginOf(url) {
    const m = String(url || '').match(/^(https?:\/\/[^\/]+)/i)
    return m ? m[1] : ''
}

class gaGetavClass extends WebApiBase {
    constructor() {
        super()
        // 自愈到可用域名后记在这里，后续请求都用它
        this._healedHost = ''
        // 正在进行的「并行选路」任务。同一时刻并发进来的多个请求共用它，
        // 避免各自发起一轮选路（否则搜索页那种一次并发 4 个请求的场景会打 4 倍请求）
        this._raceTask = null
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
                gaTgGroup +
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
                'User-Agent': gaUa,
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
            path = '/api/genres?limit=' + gaFolderLimit + '&sort=popular&locale=zh-CN'
        } else if (folderType === 'studios') {
            path = '/api/studios?limit=' + gaFolderLimit + '&sort=popular&locale=zh-CN'
        } else if (folderType === 'codes') {
            path = '/api/codes?limit=' + gaFolderLimit + '&sort=popular&locale=zh-CN'
        } else if (folderType === 'stars') {
            path =
                '/api/stars?page=1&limit=' +
                gaFolderLimit +
                '&sort=popular&locale=zh&gender=' +
                gaStarGender
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
            lines.push(['精彩预告', /^https?:\/\//i.test(pv) ? pv : gaStaticHost + pv])
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
        const i = h ? this._indexOfDomain(h) : -1
        return i === -1 ? gaDomains[0] : this._domains()[i]
    }

    /**
     * 返回当前要尝试的域名顺序。
     *
     * 🔴 关键修复点：`_healedHost` 必须参与排序。
     * 原版把「探测到的可用域名」记在 `_healedHost` 里，但这个方法完全不看它 ——
     * 于是每次请求都还是从列表第一条（一个不通的域名）重新开始试，
     * 等于自愈白做了。实测代价：每请求 +43 秒。
     */
    _domains() {
        const base = this._domainOrder || gaDomains
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
     * 取接口。三层策略，按「已知可用 → 并行选路 → 串行兜底」递进：
     *
     * ① 已记住可用域名（`_healedHost`）：单发一次，成功即返回 —— 日常路径，1 个请求。
     * ② 还不认识路：所有域名**并行竞速**，谁先返回可用 JSON 用谁 —— 约 1 秒出结果，
     *    不再像原版那样串行干等（原版最坏 = 0.22s + 42s + 1s ≈ 43 秒/请求）。
     *    同一时刻并发进来的多个请求共用同一次竞速，不会各选各的。
     * ③ 竞速全败：退回串行逐个试（保底，也能把逐条失败原因收集齐）。
     *
     * 三个分支都遵循原版同一原则：**不额外打探测请求**，永远请求目标路径本身。
     */
    async apiGet(path) {
        // ① 快路径：已探明域名直接单发
        if (this._healedHost) {
            const r = await this.get(this._healedHost + path)
            const json = gaParseJsonData(r.data)
            if (json) {
                return { json: json, error: '' }
            }
            // 这个域名失效了，清掉，重新选路
            this._healedHost = ''
        }

        // ② 已经有一轮选路在跑：等它出结果，再用选出的域名单发本路径
        if (this._raceTask) {
            await this._raceTask
            if (this._healedHost) {
                const r = await this.get(this._healedHost + path)
                const json = gaParseJsonData(r.data)
                if (json) {
                    return { json: json, error: '' }
                }
                this._healedHost = ''
            }
            return await this.serialApi(path)
        }

        // ③ 发起一轮选路（必须同步赋值，否则同时进来的调用看不到它）
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
        return await this.serialApi(path)
    }

    /** 串行兜底：只在并行竞速全失败时走，用来把逐条失败原因收集齐 */
    async serialApi(path) {
        const ds = this._domains()
        let last = null
        for (let i = 0; i < ds.length; i++) {
            const r = await this.get(ds[i] + path)
            last = r
            const json = gaParseJsonData(r.data)
            if (json) {
                this._healedHost = ds[i]
                return { json: json, error: '' }
            }
        }
        return { json: null, error: this.describeFailure(last) }
    }

    /**
     * 并行竞速：所有域名同时请求同一路径，第一个返回「可用 JSON」的胜出并被记住。
     *
     * 判据必须是「真的解析出了 JSON」，不能只看「响应快」——
     * 否则会把「回得快但内容是错误页」的域名记成可用域名，后续全盘走错。
     */
    raceApi(path) {
        const ds = this._domains()
        const self = this
        return new Promise(function (resolve) {
            if (!ds.length) {
                resolve({ json: null, error: '没有可用的域名' })
                return
            }
            let done = false
            let pending = ds.length
            let last = null
            for (let i = 0; i < ds.length; i++) {
                const host = ds[i]
                self
                    .get(host + path)
                    .then(function (r) {
                        if (done) {
                            return
                        }
                        const json = gaParseJsonData(r.data)
                        if (json) {
                            done = true
                            self._healedHost = host
                            resolve({ json: json, error: '' })
                        } else {
                            last = r
                        }
                    })
                    .catch(function () {})
                    .then(function () {
                        pending--
                        if (!done && pending === 0) {
                            resolve({ json: null, error: self.describeFailure(last) })
                        }
                    })
            }
        })
    }

    async get(url) {
        const origin = gaOriginOf(url) || this.curHost()
        try {
            const p = await req(url, {
                headers: {
                    'User-Agent': gaUa,
                    Accept: 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    Origin: origin,
                    Referer: origin + '/',
                },
                // 显式超时：原版不传，遇到 getav.me 那种黑洞域名时由 App 默认值决定，
                // 实测本机就要干等 42 秒（真机 TCP 层超时可能更久）。10 秒是安全取值。
                sendTimeout: gaTimeoutMs,
                receiveTimeout: gaTimeoutMs,
            })
            return { code: p.code, data: p.data, error: p.error || '' }
        } catch (e) {
            return { code: -1, data: null, error: e.message }
        }
    }

    /**
     * 把「拿到的不是 JSON」这种失败翻译成人话，方便排查
     */
    describeFailure(r) {
        if (!r) {
            return '网络请求失败，请稍后重试'
        }
        const body = gaAsText(r.data)
        if (body.indexOf('Just a moment') !== -1 || body.indexOf('cf-chl') !== -1 || body.indexOf('challenge-platform') !== -1) {
            return '被 Cloudflare 人机验证拦了（请求太密），等几分钟再试或换个分类'
        }
        if (body.indexOf('Edge IP Restricted') !== -1 || body.indexOf('error code: 1034') !== -1) {
            return 'CDN 边缘节点异常（Cloudflare 1034），稍后重试或切换网络'
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
            // 这几个域名时不时会换，给个查最新地址的地方
            return '所有官方域名都连不上（' + (r.error || '网络错误') + '）。可到 https://getav.info 看最新地址；若一直不通，试试把 DNS 换成 8.8.8.8 / 1.1.1.1'
        }
        return '接口返回异常（HTTP ' + r.code + '）'
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
        return gaStaticHost + (s.indexOf('/') === 0 ? s : '/' + s)
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

var getav2026 = new gaGetavClass()
