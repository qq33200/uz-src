// ignore
//@name:[禁] 蝴蝶影院
//@version:1
//@webSite:https://ptt01.com
//@remark:PTT01 系列站，带动态域名自愈，支持类型/地区/年份筛选。停用可在源列表里删掉。
//@type:100
//@instance:hudieyingyuan2026
//@isAV:1
//@order: E
import { } from '../../core/uzVideo.js'
import { } from '../../core/uzHome.js'
import { } from '../../core/uz3lib.js'
import { } from '../../core/uzUtils.js'
// ignore

/**
 * 是否启用「类型 / 地区 / 年份」筛选面板。
 * 如果你的版本点分类后列表空白，把这里改成 false 再重新导入即可退回纯分类模式。
 */
const kEnableFilter = true

class hudieYingYuanClass extends WebApiBase {
    constructor() {
        super()
        // 默认线路，可用时优先用 App 里配置的 @webSite
        this.kDefaultSite = 'https://ptt01.com'
        // 导航页解析失败时的兜底线路
        this.kFallbackSites = [
            'https://ptt2.my',
            'https://ptt01.com',
            'https://ptt02.nl',
            'https://ptt02.cc',
            'https://ptt02.net',
        ]
        // 导航页（返回 HTTP 500 但正文里含 base64 线路清单，属正常）
        this.kNavUrls = ['https://x99dh.cc', 'https://x99dh.one', 'https://x99dh.vip']
        // 在导航清单里认站的关键词
        // 注意：原 py 用的是 name == '三级片资源' 精确相等，而站点实际名叫
        // 「三级片资源，稀缺资源」，所以原自愈逻辑永远匹配不上，这里改成包含匹配。
        this.kSiteKeys = ['三级片资源', '稀缺资源']
        this.kTgGroup = 'https://t.me/tvshare23'
        this.kUa =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        this.kHeaders = {
            'User-Agent': this.kUa,
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
        // 自愈后的线路，仅存活于本次运行
        this._healedSite = ''
    }

    //MARK: - 分类

    /**
     * 获取一级分类
     * @param {UZArgs} args
     * @returns {Promise<RepVideoClassList>}
     */
    async getClassList(args) {
        let backData = new RepVideoClassList()
        try {
            let webUrl = args.url
            if (webUrl && /^https?:/i.test(webUrl)) {
                this.webSite = this.removeTrailingSlash(webUrl)
            }

            const raw = [
                ['🎬 电影', '/p/1'],
                ['📺 电视剧', '/p/3'],
                ['🌸 动漫', '/p/4'],
                ['🎤 综艺', '/p/2'],
                ['⚡ 短剧', '/p/66'],
                ['⚽ 体育', '/p/53'],
            ]
            let list = []
            for (let i = 0; i < raw.length; i++) {
                let videoClass = new VideoClass()
                videoClass.type_id = raw[i][1]
                videoClass.type_name = raw[i][0]
                videoClass.hasSubclass = kEnableFilter
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
            const mainId = this.pathOf(args.url)
            let sub = new VideoSubclass()
            sub.class = []
            sub.filter = this.buildFilters(mainId)
            backData.data = sub
        } catch (error) {
            backData.error = '获取筛选项失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 列表

    /**
     * 获取分类视频列表（无筛选时走这里）
     * @param {UZArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async getVideoList(args) {
        let backData = new RepVideoList()
        try {
            let path = this.pathOf(args.url)
            if (args.page && args.page > 1) {
                path += (path.indexOf('?') !== -1 ? '&' : '?') + 'page=' + args.page
            }
            const r = await this.fetchWithHeal(path)
            backData.error = r.error
            backData.data = this.parseCardList(r.data)
            backData.total = 9999
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
            let path = this.pathOf(args.mainClassId || args.url)
            let query = []
            let classId = ''

            const filters = args.filter || []
            for (let i = 0; i < filters.length; i++) {
                const f = filters[i] || {}
                const key = f.key || ''
                const val = f.id || ''
                if (!val || val === 'all') {
                    continue
                }
                if (key === 'class_id') {
                    classId = val
                } else if (key === 'area_id' || key === 'year') {
                    query.push(key + '=' + encodeURIComponent(val))
                }
            }

            // 原 py：req_path = base_path + class_id
            if (classId) {
                path += classId
            }
            if (args.page && args.page > 1) {
                query.push('page=' + args.page)
            }
            if (query.length) {
                path += (path.indexOf('?') !== -1 ? '&' : '?') + query.join('&')
            }

            const r = await this.fetchWithHeal(path)
            backData.error = r.error
            backData.data = this.parseCardList(r.data)
            backData.total = 9999
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
            const target = this.abs(args.url)
            const r = await this.fetchWithHeal(target)
            const html = r.data || ''
            backData.error = r.error

            let vod_name = 'PTT01正片'
            const mTitle = html.match(/<title>(.*?)<\/title>/i)
            if (mTitle) {
                vod_name = mTitle[1].split('-')[0].trim()
            }

            let vod_pic = ''
            const mPic = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            if (mPic) {
                vod_pic = mPic[1].trim()
            }

            let desc = 'PTT01 官方直连专线'
            const mDesc = html.match(
                /class=["'][^"']*(?:detail|intro|summary|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
            )
            if (mDesc) {
                const clean = mDesc[1].replace(/<[^>]+>/g, '').trim()
                if (clean) {
                    desc = clean.slice(0, 250)
                }
            }

            // 优先取页面里现成的 m3u8
            let playItems = []
            const streams = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/g)
            if (streams && streams.length) {
                playItems.push('正片$' + streams[0].split('\\/').join('/'))
            } else {
                const re = /<a[^>]+href=["'](\/v\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
                let m
                let seen = {}
                while ((m = re.exec(html)) !== null) {
                    const href = m[1]
                    const ep = m[2].replace(/<[^>]+>/g, '').trim()
                    if (!ep) {
                        continue
                    }
                    if (ep.indexOf('快捷键') !== -1 || ep.indexOf('XVIDEOS') !== -1 || ep.indexOf('广告') !== -1) {
                        continue
                    }
                    if (seen[href]) {
                        continue
                    }
                    seen[href] = 1
                    playItems.push(ep + '$' + href)
                }
            }

            const fullDesc =
                '【🔥 官方交流群: ' +
                this.kTgGroup +
                '】\n【当前发布域名: ' +
                this.curSite() +
                '】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                desc

            let detModel = new VideoDetail()
            detModel.vod_id = target
            detModel.vod_name = vod_name
            detModel.vod_pic = vod_pic
            detModel.vod_actor = '🦋 TG群: @tvshare23'
            detModel.vod_director = '🦋 蝴蝶影视'
            detModel.vod_remarks = 'HD原画'
            detModel.vod_content = fullDesc
            detModel.vod_play_from = 'PTT01专线'
            detModel.vod_play_url = playItems.length ? playItems.join('#') : '正片$http://127.0.0.1'
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
            let playUrl = String(args.url || '').trim()

            // 还是 /v/xxxx 这种中转页时，去页面里抠真正的 m3u8
            if (!/^https?:\/\//i.test(playUrl) && playUrl.indexOf('/') === 0) {
                const r = await this.fetchWithHeal(playUrl)
                const m = (r.data || '').match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/)
                if (m) {
                    playUrl = m[0].split('\\/').join('/')
                } else {
                    playUrl = this.abs(playUrl)
                }
            }

            backData.headers = {
                'User-Agent': this.kUa,
                Referer: this.curSite() + '/',
                Origin: this.curSite(),
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
     * 实测：该系列站已从服务端关闭站内搜索，/search、/node/search 等所有搜索路径
     * 一律返回 503「站点维护中」。这里做尽力尝试，失败时回一个明确提示。
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
            let path = '/search?q=' + encodeURIComponent(kw)
            if (args.page && args.page > 1) {
                path += '&page=' + args.page
            }
            const r = await this.fetchWithHeal(path)
            if (r.code !== 200) {
                backData.error = '该站点已关闭站内搜索（返回 ' + r.code + '），请在分类里翻或换个源的搜索'
                return JSON.stringify(backData)
            }
            backData.data = this.parseCardList(r.data)
            backData.total = 9999
        } catch (error) {
            backData.error = '搜索失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 页面解析

    parseCardList(htmlText) {
        let cards = []
        if (!htmlText) {
            return cards
        }
        let seen = {}

        let blocks = htmlText.match(
            /<div[^>]+class=["'][^"']*item[^"']*["'][\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi
        )
        if (!blocks || !blocks.length) {
            blocks = htmlText.match(/<a[^>]+href=["']\/\d+["'][\s\S]*?<\/a>/gi)
        }
        if (!blocks) {
            return cards
        }

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i]
            const mHref = block.match(/href=["'](\/(\d+))["']/)
            if (!mHref) {
                continue
            }
            const path = mHref[1]
            if (seen[path]) {
                continue
            }

            let title = ''
            const mTitle = block.match(/title=["']([^"']+)["']/)
            if (mTitle) {
                title = mTitle[1].trim()
            }
            if (!title) {
                const mTxt = block.match(/>([^<]{1,30})<\/a>/)
                if (mTxt) {
                    const clean = mTxt[1].trim()
                    if (clean && clean.indexOf('fa-') !== 0) {
                        title = clean
                    }
                }
            }
            if (!title) {
                title = '视频 ' + mHref[2]
            }

            let imgSrc = ''
            const mImg = block.match(/(?:src|data-original|data-src)=["']([^"']+)["']/i)
            if (mImg) {
                const cand = mImg[1].trim()
                const low = cand.toLowerCase()
                const bad = low.indexOf('logo') !== -1 || low.indexOf('avatar') !== -1
                if (!bad && low.indexOf('icon') === -1 && low.indexOf('.svg') === -1) {
                    imgSrc = this.abs(cand)
                }
            }

            const mRem = block.match(
                /class=["'][^"']*(?:badge|label|text-muted|remarks)[^"']*["'][^>]*>([^<]+)</i
            )
            // 原 py 只在「完全没匹配到标签」时才回退 HD，匹配到空标签会留下空备注；
            // 这里把空字符串也纳入回退，行为更符合原意。
            const remarks = mRem && mRem[1].trim() ? mRem[1].trim() : 'HD'

            seen[path] = 1
            cards.push({
                vod_id: path,
                vod_name: this.unescape(title),
                vod_pic: imgSrc,
                vod_remarks: remarks,
            })
        }
        return cards
    }

    //MARK: - 筛选定义

    buildFilters(mainId) {
        const areas = [
            ['全部', ''],
            ['大陆', '2'],
            ['香港', '5'],
            ['台湾', '4'],
            ['韩国', '17'],
            ['日本', '18'],
            ['欧美', '6'],
            ['泰国', '10'],
        ]
        const movieTypes = [
            ['全部', ''],
            ['伦理', '/c/33'],
            ['动作', '/c/5'],
            ['喜剧', '/c/6'],
            ['爱情', '/c/7'],
            ['科幻', '/c/8'],
            ['恐怖', '/c/9'],
            ['犯罪', '/c/10'],
            ['战争', '/c/11'],
            ['动漫', '/c/12'],
            ['剧情', '/c/13'],
            ['纪录', '/c/14'],
            ['悬疑', '/c/15'],
            ['动画', '/c/16'],
            ['解说', '/c/35'],
        ]
        let years = [['全部', '']]
        for (let y = 2026; y > 2015; y--) {
            years.push([String(y), String(y)])
        }

        let titles = []
        if (mainId === '/p/1') {
            titles.push(['类型', 'class_id', movieTypes])
        }
        titles.push(['地区', 'area_id', areas])
        titles.push(['年份', 'year', years])

        let out = []
        for (let i = 0; i < titles.length; i++) {
            let ft = new FilterTitle()
            ft.name = titles[i][0]
            let labels = []
            const vals = titles[i][2]
            for (let j = 0; j < vals.length; j++) {
                let fl = new FilterLabel()
                fl.name = vals[j][0]
                fl.id = vals[j][1]
                fl.key = titles[i][1]
                labels.push(fl)
            }
            ft.list = labels
            out.push(ft)
        }
        return out
    }

    //MARK: - 网络与线路自愈

    curSite() {
        if (this._healedSite) {
            return this._healedSite
        }
        if (this.webSite && /^https?:/i.test(this.webSite)) {
            return this.removeTrailingSlash(this.webSite)
        }
        return this.kDefaultSite
    }

    abs(p) {
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
        if (s.indexOf('/') === 0) {
            return this.curSite() + s
        }
        return this.curSite() + '/' + s
    }

    pathOf(u) {
        const s = String(u || '').trim()
        if (!s) {
            return ''
        }
        const m = s.match(/^https?:\/\/[^\/]+(\/[\s\S]*)?$/i)
        if (m) {
            return m[1] || '/'
        }
        return s
    }

    hostOf(u) {
        const m = String(u || '').match(/^https?:\/\/([^\/]+)/i)
        return m ? m[1] : ''
    }

    removeTrailingSlash(str) {
        const s = String(str || '')
        return s.endsWith('/') ? s.slice(0, -1) : s
    }

    async get(url, referer) {
        try {
            const p = await req(url, {
                headers: {
                    ...this.kHeaders,
                    Referer: referer || this.curSite() + '/',
                },
                // 原 py 的 _fetch 用的是 timeout=10（秒）。
                // uz 这两个参数的单位存疑：core/core/uzUtils.js 里那段调试实现是直接
                // 交给 setTimeout（毫秒，默认 30000），但真机走的是原生桥 sendMessage('req')，
                // 而全库唯一一处官方用法 receiveTimeout: 40 只有读作「40 秒」才合理。
                // 这里取 10000：毫秒语义下正好等于原 py 的 10 秒；秒语义下与不传无实质差别
                // （原来写的 12000 在毫秒语义下其实也没问题，只是与上面那句“原 py 10 秒”不一致）。
                sendTimeout: 10000,
                receiveTimeout: 10000,
            })
            return { code: p.code, data: p.data || '', error: p.error || '' }
        } catch (e) {
            return { code: -1, data: '', error: e.message }
        }
    }

    async fetchWithHeal(pathOrUrl, referer) {
        const url = this.abs(pathOrUrl)
        const r = await this.get(url, referer)
        if (r.code === 200 && r.data) {
            return r
        }

        const oldHost = this.hostOf(this.curSite())
        const ok = await this.refreshSite()
        if (!ok) {
            return r
        }
        const newHost = this.hostOf(this.curSite())
        if (!newHost || newHost === oldHost) {
            return r
        }
        const retryUrl = url.split(oldHost).join(newHost)
        const r2 = await this.get(retryUrl, referer)
        return r2.data ? r2 : r
    }

    /**
     * 从导航页解析线路清单，逐个探测取第一个可用的
     * @returns {Promise<boolean>}
     */
    async refreshSite() {
        let cands = []

        for (let i = 0; i < this.kNavUrls.length; i++) {
            const p = await this.get(this.kNavUrls[i])
            const text = p.data || ''
            if (!text) {
                continue
            }
            const blocks = text.match(/["']([A-Za-z0-9+/=]{100,})["']/g) || []
            for (let j = 0; j < blocks.length; j++) {
                let decoded = ''
                try {
                    decoded = decodeURIComponent(this.b64ToText(blocks[j].slice(1, -1)))
                } catch (e) {
                    continue
                }
                if (decoded.indexOf('[') === -1) {
                    continue
                }
                let list = null
                try {
                    list = JSON.parse(decoded)
                } catch (e) {
                    continue
                }
                if (!list || !list.length) {
                    continue
                }
                for (let k = 0; k < list.length; k++) {
                    const item = list[k] || {}
                    const nm = String(item.name || '')
                    let hit = false
                    for (let z = 0; z < this.kSiteKeys.length; z++) {
                        if (nm.indexOf(this.kSiteKeys[z]) !== -1) {
                            hit = true
                            break
                        }
                    }
                    if (!hit) {
                        continue
                    }
                    const us = []
                    if (item.url) {
                        us.push(item.url)
                    }
                    const arr = item.urls || []
                    for (let y = 0; y < arr.length; y++) {
                        if (arr[y] && arr[y].url && us.indexOf(arr[y].url) === -1) {
                            us.push(arr[y].url)
                        }
                    }
                    for (let y = 0; y < us.length; y++) {
                        if (cands.indexOf(us[y]) === -1) {
                            cands.push(us[y])
                        }
                    }
                }
            }
            if (cands.length) {
                break
            }
        }

        for (let i = 0; i < this.kFallbackSites.length; i++) {
            if (cands.indexOf(this.kFallbackSites[i]) === -1) {
                cands.push(this.kFallbackSites[i])
            }
        }

        for (let i = 0; i < cands.length; i++) {
            const base = this.hostOf(cands[i]) ? cands[i].match(/^https?:\/\/[^\/]+/i)[0] : ''
            if (!base) {
                continue
            }
            const chk = await this.get(base + '/p/1')
            if (chk.code === 200 && chk.data && chk.data.length > 1000) {
                this._healedSite = base
                return true
            }
        }
        return false
    }

    //MARK: - 工具

    b64ToText(b64) {
        let bin = ''
        if (typeof atob === 'function') {
            try {
                bin = atob(String(b64).replace(/[^A-Za-z0-9+/=]/g, ''))
            } catch (e) {
                bin = ''
            }
        }
        if (!bin) {
            bin = this.b64ToBin(b64)
        }
        return this.binToUtf8(bin)
    }

    b64ToBin(b64) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        const clean = String(b64).replace(/[^A-Za-z0-9+/]/g, '')
        let out = ''
        const at = (i) => (i < clean.length ? chars.indexOf(clean[i]) : 0)
        for (let i = 0; i < clean.length; i += 4) {
            const n = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3)
            out += String.fromCharCode((n >> 16) & 0xff)
            if (i + 2 < clean.length) {
                out += String.fromCharCode((n >> 8) & 0xff)
            }
            if (i + 3 < clean.length) {
                out += String.fromCharCode(n & 0xff)
            }
        }
        return out
    }

    binToUtf8(bin) {
        let out = ''
        for (let i = 0; i < bin.length; ) {
            const c = bin.charCodeAt(i)
            if (c < 0x80) {
                out += String.fromCharCode(c)
                i += 1
            } else if (c < 0xe0) {
                out += String.fromCharCode(((c & 0x1f) << 6) | (bin.charCodeAt(i + 1) & 0x3f))
                i += 2
            } else if (c < 0xf0) {
                out += String.fromCharCode(
                    ((c & 0x0f) << 12) | ((bin.charCodeAt(i + 1) & 0x3f) << 6) | (bin.charCodeAt(i + 2) & 0x3f)
                )
                i += 3
            } else {
                const cp =
                    ((c & 0x07) << 18) |
                    ((bin.charCodeAt(i + 1) & 0x3f) << 12) |
                    ((bin.charCodeAt(i + 2) & 0x3f) << 6) |
                    (bin.charCodeAt(i + 3) & 0x3f)
                const off = cp - 0x10000
                out += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff))
                i += 4
            }
        }
        return out
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

var hudieyingyuan2026 = new hudieYingYuanClass()
