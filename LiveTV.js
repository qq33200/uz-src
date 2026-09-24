// ignore
//@name:[禁] 电视直播
//@version:1
//@webSite:http://107.150.60.122/live/cctv6hd.m3u8
//@remark:96 个频道全硬编码、零网络请求（点开就是列表，不转圈）。8 个分类含 4 个成人分类；2026-09-24 实测 71/96 可直连，失效频道已排到每类末尾但全部保留（链接会自行复活），右侧备注写明每个频道的实测状态。支持按频道名搜索。
//@type:100
//@instance:livetv2026
//@isAV:1
//@order: E
import { } from '../../core/uzVideo.js'
import { } from '../../core/uzHome.js'
import { } from '../../core/uz3lib.js'
import { } from '../../core/uzUtils.js'
// ignore

/**
 * 电视直播 —— 纯静态频道表源
 *
 * 特点：一个网络请求都不发。频道表整个内联在类里，所以列表是瞬间出来的，
 * 也不会因为上游站点抽风而打不开（原 py 版也是这么做的，保持原逻辑）。
 *
 * 实测状态（2026-09-24 逐条探测）：
 *   电影台                  可直连  3/8    跳转 4  失效 1
 *   体育台                  可直连  0/5    跳转 3  失效 2
 *   港台                   可直连  2/3    跳转 0  失效 1
 *   🔞+直播台                可直连  8/10   跳转 0  失效 2
 *   🔞午夜剧场                可直连 22/22   跳转 0  失效 0
 *   🔞港台三级                可直连 21/30   跳转 0  失效 9
 *   🔞其他影片                可直连  2/2    跳转 0  失效 0
 *   🔞美国成人版               可直连 13/16   跳转 0  失效 3
 * 合计：71/96 可直连（42×200 + 29×206），7 个跳转线路。
 * 每类内部按「可直连 → 跳转 → 疑似失效」排序，死链不会挡在你前面。
 *
 * 关于 webSite：本源没有对应站点，该字段只是占位（uz 要求非空），代码里完全不依赖它。
 */
class tvLiveClass extends WebApiBase {
    constructor() {
        super()
        // 不是给请求用的 —— 本源不发请求；留着以备将来某些频道需要 UA 时使用
        this.tvUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        this._tvFlatCache = null
    }

    //MARK: - 频道表

    /**
     * 8 个分类 / 96 个频道。
     * 每个频道 = [名称, 播放地址, 探测状态]
     *   2 = 2026-09-24 实测可直连(200/206)
     *   1 = 跳转线路(30x，播放器一般能跟随)
     *   0 = 疑似失效（保留，链接会复活）
     * 每类内部已按 2 → 1 → 0 排好序。
     * @returns {{id:string,name:string,note:string,chs:[string,string,number][]}[]}
     */
    tvTable() {
        return [
            {
                id: "movie",
                name: "电影台",
                note: "3/8 实测可直连、4 个跳转",
                chs: [
                    ["NOW爆谷台", "http://173.208.234.146/live/nowbg.m3u8", 2],
                    ["NOW星影台", "http://173.208.234.146/live/nowxy.m3u8", 2],
                    ["美亚电影HD", "http://173.208.234.146/live/mymovie.m3u8", 2],
                    ["CCTV6电影", "http://107.150.60.122/live/cctv6hd.m3u8", 1],
                    ["龙华电影*线路2", "http://iptv.4666888.xyz/iptv2A.php?id=45", 1],
                    ["靖天电影", "http://iptv.4666888.xyz/iptv2A.php?id=56", 1],
                    ["東森电影", "http://iptv.4666888.xyz/iptv2A.php?id=48", 1],
                    ["龙华电影*线路1", "https://cdn.qd.je/163189/lhdy", 0],
                ],
            },
            {
                id: "sports",
                name: "体育台",
                note: "0/5 实测可直连、3 个跳转",
                chs: [
                    ["CCTV5体育*线路1", "http://173.208.212.130:8181/1080p/cctv5.m3u8", 1],
                    ["CCTV5+体育赛事", "http://107.150.60.122/live/cctv5p.m3u8", 1],
                    ["CCTV16奥林匹克*线路1", "http://207.56.13.146:81/cdnlive/cctv16.m3u8", 1],
                    ["CCTV5体育*线路2", "https://php.jdshipin.com:2096/TVOD/iptv.php?id=cctv5", 0],
                    ["CCTV16奥林匹克*线路2", "https://php.jdshipin.com:2096/TVOD/iptv.php?id=cctv16", 0],
                ],
            },
            {
                id: "hktw",
                name: "港台",
                note: "2/3 实测可直连",
                chs: [
                    ["翡翠台*线路1", "http://183.62.8.58:50085/tsfile/live/0017_1.m3u8?key=txiptv&playlive=1&authid=0", 2],
                    ["翡翠台4K(挂梯)", "https://cdn3.indevs.in/stream/tvb/fct4k/", 2],
                    ["翡翠台*线路2(挂梯)", "https://cdn.qd.je/163189.php?id=fct", 0],
                ],
            },
            {
                id: "live18",
                name: "🔞+直播台",
                note: "8/10 实测可直连",
                chs: [
                    ["俄罗斯极限电影台", "http://ef90a6cd.rossteleccom.net/iptv/2TBC4G2WWDG6RSUSN5SXSQEC/14158/index.m3u8", 2],
                    ["惊艳台*线路1", "http://15.204.105.50:25461/live/G2s9zK2n9m/xDtwVfWM8T/85.ts", 2],
                    ["惊艳台*线路2", "http://15.204.105.50:25461/live/G2s9zK2n9m/xDtwVfWM8T/87.ts", 2],
                    ["潘多啦完美", "http://15.204.105.50:25461/live/G2s9zK2n9m/xDtwVfWM8T/86.ts", 2],
                    ["香蕉台HD", "http://15.204.105.50:25461/live/G2s9zK2n9m/xDtwVfWM8T/117.ts", 2],
                    ["松视1", "http://15.204.105.50:25461/live/G2s9zK2n9m/xDtwVfWM8T/88.ts", 2],
                    ["松视2", "http://15.204.105.50:25461/live/G2s9zK2n9m/xDtwVfWM8T/89.ts", 2],
                    ["松视3", "http://15.204.105.50:25461/live/G2s9zK2n9m/xDtwVfWM8T/90.ts", 2],
                    ["奧視", "http://125.227.210.55:1022/VideoInput/play.ts", 0],
                    ["奧視2", "http://125.227.210.55:3031/VideoInput/play.ts", 0],
                ],
            },
            {
                id: "midnight18",
                name: "🔞午夜剧场",
                note: "22/22 实测可直连",
                chs: [
                    ["极限电影台", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/8c855fdf/index.m3u8", 2],
                    ["🌲松视1️⃣台", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/8c85giea/index.m3u8", 2],
                    ["🌲松视2️⃣台", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/8c85fsaf/index.m3u8", 2],
                    ["🍌香焦台HD", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/mdfdc123/index.m3u8", 2],
                    ["潘多啦完美", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/8c855d75/index.m3u8", 2],
                    ["HAPPY", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/mdfdc125/index.m3u8", 2],
                    ["🌈🅴彩虹E", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/8c855daa/index.m3u8", 2],
                    ["驚艷台HD", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/sajdxxzc/index.m3u8", 2],
                    ["M麻辣传媒", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/asdm3134/index.m3u8", 2],
                    ["中字➊", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/8jainsbq/index.m3u8", 2],
                    ["中字➋", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/v19a2133/index.m3u8", 2],
                    ["中字➌", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/56ffe9b8/index.m3u8", 2],
                    ["中字➍", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/2a8cba45/index.m3u8", 2],
                    ["中字➎", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/48a8dcb9/index.m3u8", 2],
                    ["中字➏", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/e8f7e463/index.m3u8", 2],
                    ["高清无码1", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/846a1ghm/index.m3u8", 2],
                    ["高清无码2", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/1bf4a301/index.m3u8", 2],
                    ["高清无码3", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/ahun18hg/index.m3u8", 2],
                    ["高清无码4", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/84a15gbc/index.m3u8", 2],
                    ["高清无码5", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/952a3vvv/index.m3u8", 2],
                    ["高清无码6", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/984fa1vb/index.m3u8", 2],
                    ["高清无码7", "http://x315601.serv00.net/cr.php?url=http://lc.aacalive.com:26789/i/ghjnvq5o/456oinav/index.m3u8", 2],
                ],
            },
            {
                id: "hk3",
                name: "🔞港台三级",
                note: "21/30 实测可直连",
                chs: [
                    ["1色降2之血玫瑰", "https://vip1.lz-cdn1.com/20220331/733_58b741b7/index.m3u8", 2],
                    ["2色降2之萬里驅魔", "https://m3u8.cdn202511.com/videos/202411/21/673e5ba03276de039d31a162/7cd5f8/index.m3u8", 2],
                    ["8聊斋画皮", "https://vip1.lz-cdn1.com/20220602/7244_b84ad9e5/1200k/hls/mixed.m3u8", 2],
                    ["11鸭王", "https://vip1.lz-cdn.com/20220917/33110_558f97e4/1200k/hls/mixed.m3u8", 2],
                    ["13玉蒲团之玉女心经", "https://vip.lzcdn2.com/20220525/7634_7f4228f1/1200k/hls/mixed.m3u8", 2],
                    ["14聊斋艳谭之玉女聊斋", "https://v8.rstu6.com/202310/10/9PN2VB66wu1/video/index.m3u8", 2],
                    ["15聊斋艳谭之月宫宝盒", "https://vip1.lz-cdn1.com/20220602/7246_8dec3f14/1200k/hls/mixed.m3u8", 2],
                    ["16聊斋婴宁", "https://vip1.lz-cdn1.com/20220602/7243_6ac4f584/1200k/hls/mixed.m3u8", 2],
                    ["17聊斋荷花三娘子", "https://vip1.lz-cdn1.com/20220602/7247_71485294/1200k/hls/mixed.m3u8", 2],
                    ["18金瓶梅", "https://vip1.lz-cdn1.com/20220516/5775_36eacadc/1200k/hls/mixed.m3u8", 2],
                    ["19金瓶梅2", "https://vip1.lz-cdn1.com/20220516/5774_3b77c66d/1200k/hls/mixed.m3u8", 2],
                    ["20.3D肉蒲团之极乐宝鉴", "https://vip1.lz-cdn.com/20220917/33091_abc5295d/1200k/hls/mixed.m3u8", 2],
                    ["21血恋", "https://m.892539.xyz/play.php?site_id=12&source_id=136514", 2],
                    ["22血恋2", "https://1.mysqldata3202s4l.com/20220906/vTtXOZiJ/index.m3u8", 2],
                    ["23鸭之一族", "https://vip.lz15uu.com/20221016/425_d50261a1/index.m3u8", 2],
                    ["24五月樱唇", "https://vostrely.com/20230510/TmmcwJpA/index.m3u8?t=1764471414752", 2],
                    ["25青楼十二房", "https://yzzy.play-cdn7.com/20220701/2057_5582dfdc/index.m3u8?t=1764471518907", 2],
                    ["27舞男情未了", "https://v.huosucdn.com/20251012/4HbI8O9k/index.m3u8", 2],
                    ["28桃色香居", "https://yzzy.play-cdn14.com/20230728/30714_4c69114e/index.m3u8?t=1764472133794", 2],
                    ["29花街狂奔", "https://svip.high23-playback.com/20240730/25025_60d99e11/index.m3u8?t=1764472224721", 2],
                    ["30三度诱惑", "https://yzzy.play-cdn8.com/20220705/1308_6ed1e7c5/index.m3u8?t=1764472324424", 2],
                    ["3倩女幽魂", "https://jkunnzyx.com/20250423/nU0wWqCw/2000kb/hls/index.m3u8", 0],
                    ["4艳降勾魂", "https://jkunnzyx.com/20250422/QZeJpxSo/2000kb/hls/index.m3u8", 0],
                    ["5唐朝禁宫秘史", "https://jkunnzyx.com/20250422/IzZnh5aN/2000kb/hls/index.m3u8", 0],
                    ["6唐朝豪放女", "https://jkunnzyx.com/20250422/ACOOZ77D/2000kb/hls/index.m3u8?t=1759862410098", 0],
                    ["7禁春", "https://jkunnzyx.com/20250420/C6pNQeJa/2000kb/hls/index.m3u8", 0],
                    ["9惊变", "https://jkunnzyx.com/20250216/DcmNwFCD/2000kb/hls/index.m3u8", 0],
                    ["10玉蒲团之偷情宝鉴", "https://sex8sex811.com/20250726/gyeUh9IH/3000kb/hls/index.m3u8", 0],
                    ["12鸭王2", "https://sex8sex811.com/20250720/ZVJOiFu6/3000kb/hls/index.m3u8", 0],
                    ["26现代情欲篇之换妻档案", "https://v8.yuglf.com/202310/16/4j17Meq1LR1/video/index.m3u8?t=1764471651631", 0],
                ],
            },
            {
                id: "other18",
                name: "🔞其他影片",
                note: "2/2 实测可直连",
                chs: [
                    ["星國版冠希玩遍新馬女網紅火爆不雅視頻精華剪輯版720P高清無水印", "https://vip6.3sybf.com/20210923/KH9uuTtd/index.m3u8", 2],
                    ["星國版冠希玩遍新馬女網紅不雅視頻瘋傳 美妝達人Bellywel篇", "https://vip6.3sybf.com/20210923/ihnWEH8C/index.m3u8", 2],
                ],
            },
            {
                id: "us18",
                name: "🔞美国成人版",
                note: "13/16 实测可直连",
                chs: [
                    ["美国禁忌1*线路2", "https://vidcdn2.eroticmv.com/dat1/taboo1980/taboo1980.m3u8", 2],
                    ["美国禁忌2*线路1关梯", "https://vip.lz15uu.com/20221208/680_c768016f/index.m3u8", 2],
                    ["美国禁忌2*线路2", "https://vidcdn2.eroticmv.com/dat1/taboo21982/Taboo21982.m3u8", 2],
                    ["美国禁忌3*线路1", "https://vip.lz15uu.com/20220922/223_778caaa1/index.m3u8", 2],
                    ["美国禁忌3*线路2", "https://vidcdn2.eroticmv.com/dat1/taboo31984/taboo31984.m3u8", 2],
                    ["美国禁忌4", "https://vidcdn2.eroticmv.com/dat1/taboo4theyoungergeneration1985/taboo4theyoungergeneration1985.m3u8", 2],
                    ["美国式禁忌1残酷的开始", "https://vidcdn2.eroticmv.com/dat1/tabooamericanstyle11985/tabooamericanstyle11985.m3u8", 2],
                    ["美国式禁忌2愈演愈烈", "https://play.subokk.com/play/kaz105Ye/index.m3u8?t=1765006650479", 2],
                    ["美国式禁忌3当上演员", "https://play.subokk.com/play/QdJOLA2e/index.m3u8", 2],
                    ["美国式禁忌4大结局", "https://vidcdn2.eroticmv.com/dat1/tabooamericanstyle41985/tabooamericanstyle41985.m3u8", 2],
                    ["白雪公主", "https://play.maoyanplay.top/20250805/1h39wTmQ/index.m3u8", 2],
                    ["阿凡达成人版", "https://play.maoyanplay.top/20250805/PHhmtY3z/index.m3u8?t=1765007830271", 2],
                    ["灰姑娘成人版", "https://bf.jisuziyuanbf.com/play/yb8JvLWe/index.m3u8", 2],
                    ["美国禁忌1*线路1", "https://hd.ijycnd.com/play/PdRgX4Ye/index.m3u8", 0],
                    ["人猿泰山", "https://jkunnzyx.com/20240109/iBdxl9Kq/index.m3u8?t=1765007467920", 0],
                    ["古墓丽影", "https://d6ii9agw2wrlt.cloudfront.net/video/2025-03-06/18/1897590592292433920/ff87ab36eea2482f97b47d72c265501f.m3u8?t=69804cd1&us=2018211755000713216&sign=b7b71c00e4095e351534eaf5fba56a04bf1e15d2", 0],
                ],
            },
        ]
    }

    /** 把分类表压成一维，vod_id 用全局下标 tvch-N，详情/播放都靠它定位 */
    tvFlat() {
        if (this._tvFlatCache) {
            return this._tvFlatCache
        }
        const out = []
        const tb = this.tvTable()
        for (let i = 0; i < tb.length; i++) {
            const g = tb[i]
            for (let j = 0; j < g.chs.length; j++) {
                out.push({
                    gid: g.id,
                    gname: g.name,
                    name: g.chs[j][0],
                    url: g.chs[j][1],
                    st: g.chs[j][2],
                })
            }
        }
        this._tvFlatCache = out
        return out
    }

    /** 某个分类的频道在 tvFlat() 里的起始下标 */
    tvIndexOfGroup(gid) {
        const tb = this.tvTable()
        let n = 0
        for (let i = 0; i < tb.length; i++) {
            if (tb[i].id === gid) {
                return n
            }
            n += tb[i].chs.length
        }
        return -1
    }

    /**
     * 从 uz 传来的 args.url 里认出是哪个分类。
     * uz 有可能原样传 type_id，也可能拼成完整 URL，所以按「最后一段」匹配，
     * 匹配不上再按下标兜底到第一个分类。
     */
    tvGroup(u) {
        const tb = this.tvTable()
        const s = String(u || '').trim()
        if (s) {
            let key = s.split('?')[0].split('#')[0]
            key = key.replace(/\/+$/, '').split('/').pop()
            try {
                key = decodeURIComponent(key)
            } catch (e) {
                // 解不开就用原串，不因为编码问题整个报废
            }
            for (let i = 0; i < tb.length; i++) {
                if (tb[i].id === key || tb[i].name === key || tb[i].name === s) {
                    return tb[i]
                }
            }
        }
        return tb[0] || null
    }

    /** 从 vod_id（tvch-12，或被 uz 拼成 URL 的版本）里取出全局下标 */
    tvParseIndex(u) {
        const m = String(u || '').match(/tvch-(\d+)/)
        return m ? parseInt(m[1], 10) : -1
    }

    tvStatusText(st) {
        if (st === 2) {
            return '实测在线'
        }
        if (st === 1) {
            return '跳转线路'
        }
        return '疑似失效'
    }

    tvMakeItem(n, c) {
        let v = new VideoDetail()
        v.vod_id = 'tvch-' + n
        v.vod_name = c.name
        v.vod_pic = ''
        v.vod_remarks = this.tvStatusText(c.st)
        v.vod_play_from = '直播线路'
        v.vod_play_url = c.name + '$' + c.url
        return v
    }

    //MARK: - 分类

    async getClassList(args) {
        let backData = new RepVideoClassList()
        try {
            const tb = this.tvTable()
            const list = []
            for (let i = 0; i < tb.length; i++) {
                let vc = new VideoClass()
                vc.type_id = tb[i].id
                vc.type_name = tb[i].name
                vc.hasSubclass = false
                list.push(vc)
            }
            backData.data = list
        } catch (error) {
            backData.error = '获取分类失败～' + (error && error.message ? error.message : error)
        }
        return JSON.stringify(backData)
    }

    async getSubclassList(args) {
        // 本源没有二级分类；hasSubclass 全是 false，uz 不会调到这里
        let backData = new RepVideoSubclassList()
        try {
            backData.data = new VideoSubclass()
        } catch (error) {
            backData.error = error.toString()
        }
        return JSON.stringify(backData)
    }

    //MARK: - 列表

    async getVideoList(args) {
        let backData = new RepVideoList()
        try {
            const g = this.tvGroup(args && args.url)
            if (!g) {
                backData.error = '没有这个分类'
                return JSON.stringify(backData)
            }
            const base = this.tvIndexOfGroup(g.id)
            const list = []
            for (let j = 0; j < g.chs.length; j++) {
                list.push(
                    this.tvMakeItem(base + j, {
                        name: g.chs[j][0],
                        url: g.chs[j][1],
                        st: g.chs[j][2],
                    })
                )
            }
            backData.data = list
            backData.total = list.length
        } catch (error) {
            backData.error = '获取频道列表失败～' + (error && error.message ? error.message : error)
        }
        return JSON.stringify(backData)
    }

    async getSubclassVideoList(args) {
        let backData = new RepVideoList()
        try {
            // 没有二级分类，直接复用主列表逻辑
            return await this.getVideoList({ url: (args && args.mainClassId) || (args && args.url) })
        } catch (error) {
            backData.error = '获取列表失败～' + (error && error.message ? error.message : error)
        }
        return JSON.stringify(backData)
    }

    //MARK: - 详情

    async getVideoDetail(args) {
        let backData = new RepVideoDetail()
        try {
            const n = this.tvParseIndex(args && args.url)
            const flat = this.tvFlat()
            if (n < 0 || n >= flat.length) {
                backData.error =
                    '频道不存在（收到 ' + JSON.stringify(String((args && args.url) || '')) + '，共 ' + flat.length + ' 个频道）'
                return JSON.stringify(backData)
            }
            const c = flat[n]
            let d = new VideoDetail()
            d.vod_id = 'tvch-' + n
            d.vod_name = c.name
            d.vod_pic = ''
            d.type_name = c.gname
            d.vod_remarks = this.tvStatusText(c.st)
            d.vod_play_from = '直播线路'
            d.vod_play_url = c.name + '$' + c.url
            d.vod_content =
                '分类：' +
                c.gname +
                '\n状态：' +
                this.tvStatusText(c.st) +
                '（2026-09-24 实测，会随时间变化；失效的链接过阵子常会自己复活）' +
                '\n地址：' +
                c.url
            backData.data = d
        } catch (error) {
            backData.error = '获取频道详情失败～' + (error && error.message ? error.message : error)
        }
        return JSON.stringify(backData)
    }

    //MARK: - 播放

    async getVideoPlayUrl(args) {
        let backData = new RepVideoPlayUrl()
        try {
            let u = String((args && args.url) || '').trim()
            // uz 通常直接把 vod_play_url 里 $ 后面那段传进来；这里做三重兼容
            const dollar = u.indexOf('$')
            if (dollar !== -1 && u.slice(0, dollar).indexOf('http') !== 0) {
                u = u.slice(dollar + 1).trim()
            }
            if (!/^https?:\/\//i.test(u)) {
                const n = this.tvParseIndex(u)
                const flat = this.tvFlat()
                if (n >= 0 && n < flat.length) {
                    u = flat[n].url
                }
            }
            if (!/^https?:\/\//i.test(u)) {
                backData.error = '拿到的不是有效播放地址：' + JSON.stringify(u)
                return JSON.stringify(backData)
            }
            backData.data = u
            // 直播流不依赖 Referer/UA，留空最通用
            backData.headers = {}
        } catch (error) {
            backData.error = '获取播放地址失败～' + (error && error.message ? error.message : error)
        }
        return JSON.stringify(backData)
    }

    //MARK: - 搜索

    /**
     * 频道名 / 分类名 本地模糊搜索（在 96 条里查，不发请求）。
     * 原 py 没有搜索 —— 这是纯新增能力，不影响原有分类浏览逻辑。
     */
    async searchVideo(args) {
        let backData = new RepVideoList()
        try {
            const kw = String((args && args.searchWord) || '').trim()
            if (!kw) {
                return JSON.stringify(backData)
            }
            const low = kw.toLowerCase()
            const flat = this.tvFlat()
            const list = []
            for (let n = 0; n < flat.length; n++) {
                const c = flat[n]
                const hitName = c.name.toLowerCase().indexOf(low) !== -1
                const hitGroup = c.gname.toLowerCase().indexOf(low) !== -1
                if (!hitName && !hitGroup) {
                    continue
                }
                const v = this.tvMakeItem(n, c)
                v.vod_remarks = c.gname + ' · ' + this.tvStatusText(c.st)
                list.push(v)
            }
            backData.data = list
            backData.total = list.length
            if (!list.length) {
                backData.error = '没有名字含「' + kw + '」的频道（本源是固定频道表）'
            }
        } catch (error) {
            backData.error = '搜索失败～' + (error && error.message ? error.message : error)
        }
        return JSON.stringify(backData)
    }
}

var livetv2026 = new tvLiveClass()
