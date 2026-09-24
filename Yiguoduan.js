// ignore
//@name:[禁] 一锅端聚合
//@version:1
//@webSite:https://av.telstra.com.cv
//@remark:51 站聚合（短剧/影视/成人/音频/动漫）。uz 无文件夹卡片机制，故把站点直接作为一级分类（按原版 6 大类聚簇排序 + 前缀），站内分类走筛选面板；播放头严格透传官方防盗链签名 x-aggr-sig。
//@type:100
//@instance:yiguoduan2026
//@isAV:1
//@order: E
import { } from '../../core/uzVideo.js'
import { } from '../../core/uzHome.js'
import { } from '../../core/uz3lib.js'
import { } from '../../core/uzUtils.js'
// ignore

// ============================================================================
// 一锅端聚合 —— 移植自 93合1.py（后端：https://av.telstra.com.cv 聚合 API）
//
// 保留原版的部分：
//   · SITES_CONFIG_DATA 全量站点与分类字典（原样嵌入，未删改）
//   · TOP_CLASSES 六个一级大类的顺序（用于把站点聚簇排序）
//   · 短剧站点的优先顺序 short_priority
//   · 接口路径协议：/api/v1/spiders/<key>/{category,home,detail,play,search}
//   · _universal_pic 图床白名单 + 官方图片代理分流
//   · 播放头严格透传后端返回的 header（含 x-aggr-sig 防盗链签名），
//     以及 cj / xifu 的专属 Referer
//   · playerContent 的 play_param_id 判定逻辑与「拿不到就用原地址兜底」
//   · 搜索：串行 12 个健康源站，每站取前 4 条，站名前缀 [KEY]
//
// 为适配 uz 而必须改动的部分（已在下方标注 ADAPT）：
//   · uz 没有 vod_tag=folder 文件夹卡片，三层导航无法表达 →
//     站点提升为一级分类，站内分类改用二级筛选面板
//   · uz 没有 parse（解析器）概念 → parse!=0 时改用 uz 的 sniffer 嗅探
//   · uz 的 req 会按 content-type 把 JSON 响应直接解析成对象 →
//     统一走 parseJsonData() 兼容「对象 / 字符串」两种形态
//   · 后端 cj 的 episodes 会返回若干条完全相同的线路 → 按播放地址去重
//   · 后端找不到播放参数时会把入参原样回显（b8xx6 传网址时就是这样）→
//     识别到「回显」后用另一个候选参数兜底重试一次
// ============================================================================

// ---------------- 站点与分类字典（自 93合1.py 原样抽取） ----------------
const kSites = {
    "asmrhoney": {"name": "ASMRHoney", "platform": "adult", "categories": [{"n": "最新更新", "v": "latest"}, {"n": "中文ASMR", "v": "lang_zh"}, {"n": "日语ASMR", "v": "lang_ja"}, {"n": "韩语ASMR", "v": "lang_ko"}, {"n": "英语ASMR", "v": "lang_en"}, {"n": "混合语言", "v": "lang_mixed"}, {"n": "舔耳", "v": "tag_ear_licking"}, {"n": "口腔音", "v": "tag_mouth_sounds"}, {"n": "触发音", "v": "tag_trigger_sounds"}, {"n": "角色扮演", "v": "tag_roleplay"}, {"n": "耳语", "v": "tag_whisper"}, {"n": "丝袜", "v": "tag_pantyhose"}, {"n": "刮擦", "v": "tag_scratching"}, {"n": "性感", "v": "tag_sexy"}, {"n": "SFW全年龄", "v": "tag_sfw"}, {"n": "NSFW", "v": "tag_nsfw"}, {"n": "耳吃", "v": "tag_eareating"}, {"n": "舌头", "v": "tag_tongue"}, {"n": "助眠", "v": "tag_sleep_aid"}, {"n": "呼吸音", "v": "tag_breathing"}, {"n": "足部", "v": "tag_feet"}, {"n": "亲吻", "v": "tag_kiss"}, {"n": "音频专辑", "v": "audio_albums"}, {"n": "音频单曲", "v": "audio_tracks"}]},
    "avxq": {"name": "AV星球", "platform": "adult", "categories": [{"n": "学生萝莉", "v": "66"}, {"n": "日本AV", "v": "44"}, {"n": "口交自慰", "v": "62"}, {"n": "群交多P", "v": "63"}, {"n": "强奸迷奸", "v": "67"}, {"n": "丝袜制服", "v": "68"}, {"n": "国产AV", "v": "46"}, {"n": "乱伦系列", "v": "45"}, {"n": "素人特摄", "v": "65"}, {"n": "探花约炮", "v": "47"}, {"n": "日韩精选", "v": "61"}, {"n": "VR专区", "v": "64"}, {"n": "主播大秀", "v": "48"}, {"n": "反差母狗", "v": "70"}, {"n": "国产传媒", "v": "50"}, {"n": "网曝吃瓜", "v": "49"}, {"n": "异域风情", "v": "71"}, {"n": "中文字幕", "v": "53"}, {"n": "偷拍偷窥", "v": "51"}, {"n": "色情动漫", "v": "55"}]},
    "b8xx6": {"name": "8XX6", "platform": "adult", "categories": [{"n": "国产", "v": "901179"}, {"n": "有码", "v": "911179"}, {"n": "无码", "v": "921179"}, {"n": "欧美", "v": "931179"}, {"n": "传媒", "v": "941179"}, {"n": "探花", "v": "951179"}, {"n": "中文", "v": "961179"}, {"n": "动漫", "v": "971179"}]},
    "cj": {"name": "初8影视", "platform": "drama", "categories": [{"n": "电影", "v": "1"}, {"n": "剧集", "v": "15"}, {"n": "动漫", "v": "30"}, {"n": "短剧", "v": "47"}, {"n": "综艺", "v": "24"}, {"n": "纪录片", "v": "63"}]},
    "imaoyou": {"name": "猫又影视", "platform": "drama", "categories": [{"n": "电影", "v": "1"}, {"n": "电视剧", "v": "2"}, {"n": "综艺", "v": "3"}, {"n": "动漫", "v": "4"}, {"n": "短剧", "v": "5"}]},
    "iyf": {"name": "爱壹帆影视", "platform": "drama", "categories": [{"n": "电影", "v": "1"}, {"n": "电视剧", "v": "2"}, {"n": "综艺", "v": "3"}, {"n": "动漫", "v": "4"}, {"n": "纪录片", "v": "5"}]},
    "djuu": {"name": "DJ呦呦", "platform": "audio", "categories": [{"n": "热歌榜", "v": "1"}, {"n": "DJ舞曲", "v": "2"}, {"n": "英文DJ", "v": "3"}, {"n": "中文DJ", "v": "4"}]},
    "huangdou": {"name": "黄豆短剧", "platform": "short", "categories": [{"n": "全部短剧", "v": "all"}, {"n": "黄豆原创", "v": "yuandou"}, {"n": "魔改短剧", "v": "mod"}, {"n": "擦边短剧", "v": "caibian"}, {"n": "真人短剧", "v": "zhenren"}, {"n": "动漫", "v": "erciyuan"}, {"n": "影院", "v": "aiman"}, {"n": "贤者", "v": "zongyi"}, {"n": "黑料", "v": "heiliao"}]},
    "kuangbiao": {"name": "狂飙短剧", "platform": "short", "categories": [{"n": "成人短剧", "v": "adult_short"}, {"n": "正规短剧", "v": "normal_short"}, {"n": "短剧", "v": "t-5jxcit"}]},
    "xifu": {"name": "喜福短剧", "platform": "short", "categories": [{"n": "爽剧", "v": "3"}, {"n": "甜宠", "v": "6"}, {"n": "逆袭", "v": "5"}, {"n": "现代言情", "v": "1"}, {"n": "都市", "v": "4"}, {"n": "玄幻", "v": "23"}, {"n": "古代言情", "v": "16"}]},
    "xingya": {"name": "星芽短剧", "platform": "short", "categories": [{"n": "剧场", "v": "1"}, {"n": "新剧", "v": "3"}, {"n": "热播", "v": "2"}, {"n": "星选", "v": "7"}, {"n": "阳光", "v": "5"}]},
    "yidouge": {"name": "一兜糖短剧", "platform": "short", "categories": [{"n": "最新发布", "v": "1"}, {"n": "热播精选", "v": "2"}]},
    "avtoday": {"name": "AVToday", "platform": "adult", "categories": [{"n": "中文字幕", "v": "中文字幕"}, {"n": "無碼", "v": "無碼"}, {"n": "FC2", "v": "FC2"}, {"n": "長腿", "v": "長腿"}, {"n": "巨乳", "v": "巨乳"}, {"n": "多人", "v": "多人"}, {"n": "素人", "v": "素人"}]},
    "hanime1": {"name": "hanime1动漫(源超时)", "platform": "anime", "categories": [{"n": "首页推荐", "v": "home"}, {"n": "最新", "v": "latest"}]},
    "jable": {"name": "Jable直播放", "platform": "adult", "categories": [{"n": "最近更新", "v": "latest-updates"}, {"n": "热门影片", "v": "hot"}, {"n": "最新上市", "v": "new-release"}, {"n": "中文字幕", "v": "chinese-subtitle"}, {"n": "角色剧情", "v": "roleplay"}, {"n": "制服诱惑", "v": "uniform"}, {"n": "丝袜美腿", "v": "pantyhose"}, {"n": "无码解放", "v": "uncensored"}]},
    "missav": {"name": "MissAV", "platform": "adult", "categories": [{"n": "国产", "v": "20"}, {"n": "日本有码", "v": "21"}, {"n": "日本无码", "v": "22"}, {"n": "中文字幕", "v": "28"}, {"n": "欧美", "v": "23"}, {"n": "动漫", "v": "24"}, {"n": "伦理", "v": "25"}]},
    "91porn": {"name": "91Porn", "platform": "adult", "categories": [{"n": "最新", "v": "watch"}, {"n": "91原创", "v": "ori"}, {"n": "当前最热", "v": "hot"}, {"n": "本月最热", "v": "top"}, {"n": "10分钟以上", "v": "long"}, {"n": "高清", "v": "hd"}]},
    "baxx": {"name": "8X8X", "platform": "adult", "categories": [{"n": "大陆", "v": "1"}, {"n": "日韩", "v": "2"}, {"n": "欧美", "v": "3"}, {"n": "动漫", "v": "4"}, {"n": "三级", "v": "5"}]},
    "chinax": {"name": "中国X站", "platform": "adult", "categories": [{"n": "国产传媒", "v": "domestic-media"}, {"n": "日本AV", "v": "japanese-av"}, {"n": "无码视频", "v": "uncensored-video"}, {"n": "中文字幕", "v": "chinese-subtitles"}]},
    "ddys": {"name": "高端视频", "platform": "adult", "categories": [{"n": "一区-日韩无码", "v": "12028759"}, {"n": "一区-中文字幕", "v": "12198759"}, {"n": "一区-国产自拍", "v": "12008759"}, {"n": "二区-91探花", "v": "12468839"}, {"n": "三区-国产精品", "v": "12038769"}]},
    "flt": {"name": "福利天堂", "platform": "adult", "categories": [{"n": "偷拍", "v": "1"}, {"n": "国产", "v": "6"}, {"n": "韩国", "v": "3"}, {"n": "无码", "v": "4"}, {"n": "动漫", "v": "5"}, {"n": "中文", "v": "7"}]},
    "tnaflix": {"name": "TNAFlix", "platform": "adult", "categories": [{"n": "最新视频", "v": "1"}, {"n": "Asian 亚洲", "v": "5"}, {"n": "Japanese 日本", "v": "34"}, {"n": "Hentai 动漫", "v": "30"}, {"n": "Homemade 自拍", "v": "31"}]},
    "youav": {"name": "YouAV", "platform": "adult", "categories": [{"n": "日本AV", "v": "22"}, {"n": "巨乳", "v": "20"}, {"n": "熟女人妻", "v": "21"}, {"n": "中文字幕", "v": "23"}, {"n": "少女蘿莉", "v": "24"}, {"n": "國產素人自拍", "v": "30"}]},
    "apilj": {"name": "辣椒资源", "platform": "adult", "categories": [{"n": "国产自拍", "v": "1"}, {"n": "欧美极品", "v": "2"}, {"n": "日韩无码", "v": "3"}, {"n": "AV明星", "v": "4"}, {"n": "中文字幕", "v": "20"}]},
    "fhzy": {"name": "番号资源", "platform": "adult", "categories": [{"n": "制服丝袜", "v": "1"}, {"n": "群交淫乱", "v": "2"}, {"n": "无码专区", "v": "3"}, {"n": "偷拍自拍", "v": "4"}, {"n": "中文字幕", "v": "6"}]},
    "jpzy": {"name": "极品资源", "platform": "adult", "categories": [{"n": "视频一区", "v": "1"}, {"n": "日韩无码", "v": "54"}, {"n": "国产精品", "v": "55"}, {"n": "自拍偷拍", "v": "60"}, {"n": "中文字幕", "v": "62"}]},
    "91md": {"name": "91麻豆", "platform": "adult", "categories": [{"n": "麻豆视频", "v": "1"}, {"n": "91制片厂", "v": "2"}, {"n": "天美传媒", "v": "3"}, {"n": "蜜桃传媒", "v": "4"}, {"n": "星空传媒", "v": "6"}]},
    "aosika": {"name": "奥斯卡资源", "platform": "adult", "categories": [{"n": "国产视频", "v": "20"}, {"n": "中文字幕", "v": "21"}, {"n": "国产传媒", "v": "22"}, {"n": "日本有码", "v": "23"}, {"n": "日本无码", "v": "24"}]},
    "ddzy": {"name": "滴滴资源", "platform": "adult", "categories": [{"n": "国产专区", "v": "20"}, {"n": "国产厂商", "v": "21"}, {"n": "日本无码", "v": "23"}, {"n": "中文字幕", "v": "25"}]},
    "douzy": {"name": "豆豆资源", "platform": "adult", "categories": [{"n": "国产视频", "v": "47"}, {"n": "国产传媒", "v": "48"}, {"n": "日本有码", "v": "53"}, {"n": "少妇人妻", "v": "74"}]},
    "heizy": {"name": "嘿嘿资源", "platform": "adult", "categories": [{"n": "国产视频", "v": "48"}, {"n": "国产自拍", "v": "49"}, {"n": "黑料吃瓜", "v": "54"}, {"n": "麻豆传媒", "v": "56"}]},
    "souav": {"name": "搜av资源", "platform": "adult", "categories": [{"n": "中文传媒", "v": "1"}, {"n": "国产", "v": "2"}, {"n": "欧美AV", "v": "3"}, {"n": "日本AV", "v": "4"}, {"n": "传媒-麻豆传媒", "v": "6"}]},
    "danaizi": {"name": "大奶子资源", "platform": "adult", "categories": [{"n": "视频一区", "v": "1"}, {"n": "精品推荐", "v": "20"}, {"n": "自拍偷拍", "v": "23"}, {"n": "制服丝袜", "v": "24"}]},
    "lsb": {"name": "老色逼资源", "platform": "adult", "categories": [{"n": "精品推荐", "v": "20"}, {"n": "国产精品", "v": "21"}, {"n": "日本有码", "v": "23"}, {"n": "中文字幕", "v": "25"}]},
    "yutu": {"name": "玉兔资源", "platform": "adult", "categories": [{"n": "精品推荐", "v": "20"}, {"n": "国产精品", "v": "21"}, {"n": "日本有码", "v": "23"}, {"n": "中文字幕", "v": "25"}]},
    "fqzy": {"name": "番茄资源", "platform": "adult", "categories": [{"n": "欧美精品", "v": "3"}, {"n": "偷拍自拍", "v": "6"}, {"n": "高清无码", "v": "13"}, {"n": "中文字幕", "v": "14"}]},
    "heiliao": {"name": "黑料资源", "platform": "adult", "categories": [{"n": "中文字幕", "v": "1"}, {"n": "日本有码", "v": "2"}, {"n": "日本无码", "v": "3"}, {"n": "自拍偷拍", "v": "29"}]},
    "hsck": {"name": "黄色仓库", "platform": "adult", "categories": [{"n": "国产区", "v": "1"}, {"n": "AV区", "v": "2"}, {"n": "欧美区", "v": "3"}, {"n": "日本无码", "v": "10"}]},
    "naixx": {"name": "奶香香资源", "platform": "adult", "categories": [{"n": "精品国产", "v": "1"}, {"n": "精品日韩", "v": "2"}, {"n": "日韩无码", "v": "28"}]},
    "slzy": {"name": "森林资源", "platform": "adult", "categories": [{"n": "精品推荐", "v": "20"}, {"n": "国产色情", "v": "22"}, {"n": "亚洲无码", "v": "24"}]},
    "thzy": {"name": "桃花资源", "platform": "adult", "categories": [{"n": "国产精品", "v": "6"}, {"n": "华语AV", "v": "7"}, {"n": "日本无码", "v": "25"}]},
    "jpx": {"name": "精品X资源", "platform": "adult", "categories": [{"n": "国产", "v": "1"}, {"n": "日本", "v": "2"}, {"n": "动漫", "v": "4"}, {"n": "高清无码", "v": "20"}]},
    "xingba": {"name": "杏吧资源", "platform": "adult", "categories": [{"n": "日韩无码", "v": "54"}, {"n": "国产主播", "v": "55"}, {"n": "中文字幕", "v": "62"}]},
    "subo2": {"name": "速播资源B", "platform": "adult", "categories": [{"n": "电影", "v": "1"}, {"n": "电视剧", "v": "2"}, {"n": "短剧", "v": "27"}]},
    "niuniuzy": {"name": "牛牛资源", "platform": "adult", "categories": [{"n": "电影", "v": "1"}, {"n": "电视剧", "v": "2"}, {"n": "国产剧", "v": "13"}]},
    "zuidapi": {"name": "最大资源", "platform": "adult", "categories": [{"n": "电影", "v": "1"}, {"n": "电视剧", "v": "2"}, {"n": "动作片", "v": "6"}]},
    "jszy": {"name": "极速资源", "platform": "adult", "categories": [{"n": "电视剧", "v": "1"}, {"n": "电影", "v": "2"}, {"n": "短剧", "v": "38"}]},
    "ffzy": {"name": "非凡资源", "platform": "adult", "categories": [{"n": "电影片", "v": "1"}, {"n": "连续剧", "v": "2"}, {"n": "短剧", "v": "36"}]},
    "xgzy": {"name": "西瓜资源", "platform": "adult", "categories": [{"n": "电影片", "v": "1"}, {"n": "连续剧", "v": "2"}, {"n": "短剧", "v": "36"}]},
    "jxzy": {"name": "量子资源", "platform": "adult", "categories": [{"n": "电影片", "v": "1"}, {"n": "连续剧", "v": "2"}, {"n": "短剧", "v": "46"}]},
    "tyyszy": {"name": "甜晕资源", "platform": "adult", "categories": [{"n": "电影", "v": "1"}, {"n": "电视剧", "v": "2"}, {"n": "短剧", "v": "54"}]},
}

const kTopClasses = [
    {"type_name": "全部", "type_id": "all", "type_flag": "1"},
    {"type_name": "短剧", "type_id": "short", "type_flag": "1"},
    {"type_name": "影视", "type_id": "drama", "type_flag": "1"},
    {"type_name": "成人", "type_id": "adult", "type_flag": "1"},
    {"type_name": "音频", "type_id": "audio", "type_flag": "1"},
    {"type_name": "动漫", "type_id": "anime", "type_flag": "1"},
]

// ---------------- 站点归属的聚合后端 ----------------
const kBase = 'https://av.telstra.com.cv'

// ---------------- 原版常量 ----------------
const kTgGroup = 'https://t.me/tvshare23'
const kBrand = '蝴蝶影视'
const kBrandActor = '🦋 TG群: @tvshare23'
const kBrandDirector = '🦋 蝴蝶影视'
const kUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

// 原版 _get_spiders_for_plat 里短剧的优先顺序
const kShortPriority = ['huangdou', 'kuangbiao', 'yidouge', 'xifu', 'xingya']

// 一级分类的聚簇顺序与前缀。原版 6 大类里「全部」等价于「所有站点」，
// 站点提升为一级后它已自然表达，故不再单列。
const kPlatforms = [
    { id: 'short', name: '短剧', emoji: '⚡' },
    { id: 'drama', name: '影视', emoji: '🎬' },
    { id: 'adult', name: '成人', emoji: '🔞' },
    { id: 'audio', name: '音频', emoji: '🎵' },
    { id: 'anime', name: '动漫', emoji: '🌸' },
]

// 原版 _universal_pic 的直连图床白名单
const kDirectPicHosts = [
    'asmrhoney.com',
    'cdn202511.com',
    'pic.892539.xyz',
    'cdn-xj.cc',
    'img.picbf.com',
    'hongniuzyimage.com',
    'cjysw.cc',
    'img.djuu.com',
    'cloudfront.net',
    'shorttv.online',
    'contentchina.com',
    'rongjuwh.cn',
    'images.weserv.nl',
]

// 原版 searchContent 的 12 个健康源站
const kSearchTargets = [
    'cj',
    'imaoyou',
    'iyf',
    'huangdou',
    'xifu',
    'xingya',
    'yidouge',
    'kuangbiao',
    'asmrhoney',
    'avxq',
    'b8xx6',
    'djuu',
]

// 原版 isVideoFormat 的判定后缀
const kVideoExt = ['.m3u8', '.mp4', '.mp3', '.m4a', '.flv', '.mkv', '.avi', '.ts', '.mpd', 'index.png']
// 原版 playerContent 里额外放行的音频后缀
const kAudioExt = ['.mp3', '.m4a', '.aac', '.wav']

/**
 * 搜索时每个源站的接收超时。
 * uz 的 req 超时单位存在两种可能解释：本地 JS 实现走 setTimeout（毫秒，默认 30000），
 * 而真机走原生桥、全库唯一一处官方用法是 receiveTimeout: 40（读作 40 秒才合理）。
 * 取 5000 在两种解释下都安全：毫秒语义=5 秒（贴合原 py 的 timeout=4），
 * 秒语义=5000 秒≈不超时（等同于不传）。
 */
const kSearchReceiveTimeout = 5000

/**
 * 兼容 uz 的 req 返回值：
 * content-type 为 application/json 时 proData.data 是「已解析好的对象」，
 * 为 text/* 或无 content-type 时是字符串，octet-stream 时是 ArrayBuffer。
 * 所以绝对不能直接 JSON.parse(pro.data)。
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
    if (typeof d === 'object' && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d)) {
        return d
    }
    return null
}

/** 原版 isVideoFormat */
function isVideoUrl(u) {
    const low = String(u || '').toLowerCase()
    for (let i = 0; i < kVideoExt.length; i++) {
        if (low.indexOf(kVideoExt[i]) !== -1) {
            return true
        }
    }
    return false
}

function hasAudioExt(u) {
    const low = String(u || '').toLowerCase()
    for (let i = 0; i < kAudioExt.length; i++) {
        if (low.indexOf(kAudioExt[i]) !== -1) {
            return true
        }
    }
    return false
}

class yiguoduanClass extends WebApiBase {
    constructor() {
        super()
        this._healedSite = ''
    }

    //MARK: - 分类

    /**
     * 获取一级分类。
     * 原版一级是 6 个大类、点进去是站点文件夹卡片；uz 没有文件夹卡片，
     * 所以这里按原版大类的顺序把站点聚簇铺开，每个站点就是一项。
     * @param {UZArgs} args
     * @returns {Promise<RepVideoClassList>}
     */
    async getClassList(args) {
        let backData = new RepVideoClassList()
        try {
            if (args && args.url && /^https?:/i.test(args.url)) {
                this.webSite = String(args.url).replace(/\/+$/, '')
            }
            let list = []
            for (let i = 0; i < kPlatforms.length; i++) {
                const plat = kPlatforms[i]
                const keys = this.platSites(plat.id)
                for (let j = 0; j < keys.length; j++) {
                    const key = keys[j]
                    const info = kSites[key] || {}
                    let videoClass = new VideoClass()
                    videoClass.type_id = key
                    videoClass.type_name = plat.emoji + ' ' + (info.name || key)
                    videoClass.hasSubclass = true
                    list.push(videoClass)
                }
            }
            backData.data = list
        } catch (error) {
            backData.error = '获取分类失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    /**
     * 获取二级筛选：该站点的真实分类。等价于原版的「站内细分类」。
     * @param {UZArgs} args
     * @returns {Promise<RepVideoSubclassList>}
     */
    async getSubclassList(args) {
        let backData = new RepVideoSubclassList()
        try {
            backData.data = new VideoSubclass()
            const siteKey = this.siteKeyOf(args && args.url)
            const cats = this.catsOf(siteKey)
            if (!cats.length) {
                backData.error = '该源站没有分类信息：' + siteKey
                return JSON.stringify(backData)
            }
            let title = new FilterTitle()
            title.name = '分类'
            title.list = []

            // 原版「初始进入站点默认指向第一个子分类」
            let def = new FilterLabel()
            def.name = '默认（' + cats[0].n + '）'
            def.id = ''
            def.key = 'cat'
            title.list.push(def)

            for (let i = 0; i < cats.length; i++) {
                let lab = new FilterLabel()
                lab.name = cats[i].n
                lab.id = String(cats[i].v)
                lab.key = 'cat'
                title.list.push(lab)
            }
            backData.data.filter = [title]
        } catch (error) {
            backData.error = '获取筛选项失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 列表

    /**
     * 未走筛选时的兜底：直接用该站点的第一个分类。
     * @param {UZArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async getVideoList(args) {
        const siteKey = this.siteKeyOf(args && args.url)
        return await this.listBySite(siteKey, (args && args.page) || 1, '')
    }

    /**
     * 带筛选的列表：站点 + 站内分类 + 页码。
     * @param {UZSubclassVideoListArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async getSubclassVideoList(args) {
        let siteKey = this.siteKeyOf(args && (args.mainClassId || args.url))
        if (!kSites[siteKey] && args && args.subclassId) {
            siteKey = this.siteKeyOf(args.subclassId)
        }
        let catV = ''
        const filters = (args && args.filter) || []
        for (let i = 0; i < filters.length; i++) {
            const f = filters[i]
            if (f && f.key === 'cat' && f.id !== undefined && f.id !== null && String(f.id) !== '') {
                catV = String(f.id)
            }
        }
        return await this.listBySite(siteKey, (args && args.page) || 1, catV)
    }

    /**
     * 调用聚合后端的 category 接口取列表。
     * @param {string} siteKey
     * @param {number} page
     * @param {string} catV 站内分类值，空则用第一个分类
     * @returns {Promise<string>} JSON
     */
    async listBySite(siteKey, page, catV) {
        let backData = new RepVideoList()
        try {
            const info = kSites[siteKey]
            if (!info) {
                backData.error = '未知源站：' + siteKey
                return JSON.stringify(backData)
            }
            const cats = this.catsOf(siteKey)
            let tid = catV
            if (!tid && cats.length) {
                tid = String(cats[0].v)
            }
            const pg = page > 0 ? page : 1
            const url = kBase + '/api/v1/spiders/' + siteKey + '/category?tid=' + encodeURIComponent(tid) + '&pg=' + pg
            const r = await this.get(url)
            const data = parseJsonData(r.data)

            let items = (data && data.list) || []

            // 原版兜底：该分类无数据时回退取 home 列表
            // （实测后端的 home 只返回 categories，不含 list，故这里通常仍为空）
            if (!items.length && pg === 1) {
                const hr = await this.get(kBase + '/api/v1/spiders/' + siteKey + '/home')
                const hd = parseJsonData(hr.data)
                items = (hd && hd.list) || []
            }

            if (!items.length) {
                // ADAPT：原版这里返回一张 vod_tag=folder 的提示卡，uz 没有文件夹，
                // 改为把提示放进 error，App 会直接显示出来。
                if (pg === 1) {
                    backData.error =
                        '「' + (info.name || siteKey) + '」该分类暂无数据或源站超时，请换其他源站或分类'
                }
                return JSON.stringify(backData)
            }

            let list = []
            for (let i = 0; i < items.length; i++) {
                const item = items[i] || {}
                const vid = String(item.id || item.vod_id || '')
                if (!vid) {
                    continue
                }
                const rawMeta =
                    item.remarks || item.vod_remarks || item.duration || item.vod_duration || ''
                let model = new VideoDetail()
                model.vod_id = siteKey + '@@' + vid
                model.vod_name = item.name || item.vod_name || '未知片名'
                model.vod_pic = this.universalPic(siteKey, item.pic || item.vod_pic || '')
                model.vod_remarks = this.formatRemarks(kBrand, rawMeta)
                list.push(model)
            }

            let total = list.length
            if (data) {
                const t = parseInt(data.total, 10)
                if (t && t > 0) {
                    total = t
                }
            }
            backData.data = list
            backData.total = total
        } catch (error) {
            backData.error = '获取列表失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 详情

    /**
     * 获取影片详情。vod_id 形如 "<siteKey>@@<realId>"。
     * @param {UZArgs} args
     * @returns {Promise<RepVideoDetail>}
     */
    async getVideoDetail(args) {
        let backData = new RepVideoDetail()
        try {
            const raw = String((args && args.url) || '').trim()
            if (!raw) {
                backData.error = '缺少影片标识'
                return JSON.stringify(backData)
            }
            let siteKey = 'cj'
            let realId = raw
            const cut = raw.indexOf('@@')
            if (cut !== -1) {
                siteKey = raw.slice(0, cut)
                realId = raw.slice(cut + 2)
            }

            const url = kBase + '/api/v1/spiders/' + siteKey + '/detail?id=' + encodeURIComponent(realId)
            const r = await this.get(url)
            let v = parseJsonData(r.data)
            if (!v) {
                backData.error = r.error || '详情接口没有返回数据'
                return JSON.stringify(backData)
            }
            // 后端实测直接返回裸对象；这里保留原版对 list / data 包装的兼容
            if (v.list && v.list.length && v.list[0]) {
                v = v.list[0]
            } else if (v.data && typeof v.data === 'object' && !(v.data instanceof Array) && !v.data.length) {
                v = v.data
            }

            const vName = v.name || v.vod_name || realId
            const vPic = this.universalPic(siteKey, v.pic || v.vod_pic || '')
            const vContent = v.content || v.vod_content || '蝴蝶聚合源站极速穿透播放。'
            const vCategory = v.category || v.type_name || ''
            const vRemarks = this.formatRemarks(kBrand, v.remarks || v.vod_remarks || '')

            const fullContent =
                '【🦋 官方交流群: ' +
                kTgGroup +
                '】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【当前源站】: ' +
                siteKey.toUpperCase() +
                '\n【影片类别】: ' +
                vCategory +
                '\n' +
                vContent

            const episodes = v.episodes || []
            let entries = []
            const seen = {}

            if (episodes.length) {
                for (let i = 0; i < episodes.length; i++) {
                    const ep = episodes[i] || {}
                    const epName = String(ep.name === undefined || ep.name === null ? '正片' : ep.name)
                        .replace(/\$/g, '_')
                        .replace(/#/g, '_')
                    const epVal = String(ep.id || ep.url || realId)
                    // ADAPT：后端的 cj 详情会返回若干条完全相同的线路，
                    // 原版会渲染成多个同名按钮，这里按播放地址去重。
                    if (seen[epVal]) {
                        continue
                    }
                    seen[epVal] = 1
                    entries.push(epName + '$' + siteKey + '@@' + realId + '@@' + encodeURIComponent(epVal))
                }
            } else if (v.vod_play_url) {
                const subs = String(v.vod_play_url).split('#')
                for (let i = 0; i < subs.length; i++) {
                    const sub = subs[i]
                    let epName = '正片'
                    let epVal = sub
                    const dollar = sub.indexOf('$')
                    if (dollar !== -1) {
                        epName = sub.slice(0, dollar)
                        epVal = sub.slice(dollar + 1)
                    }
                    if (seen[epVal]) {
                        continue
                    }
                    seen[epVal] = 1
                    entries.push(
                        epName.replace(/\$/g, '_').replace(/#/g, '_') +
                            '$' +
                            siteKey +
                            '@@' +
                            realId +
                            '@@' +
                            encodeURIComponent(epVal)
                    )
                }
            } else {
                entries.push('正片$' + siteKey + '@@' + realId + '@@' + encodeURIComponent(realId))
            }

            let detModel = new VideoDetail()
            detModel.vod_id = raw
            detModel.vod_name = vName
            detModel.vod_pic = vPic
            detModel.type_name = vCategory
            detModel.vod_remarks = vRemarks
            detModel.vod_actor = kBrandActor
            detModel.vod_director = kBrandDirector
            detModel.vod_content = fullContent
            detModel.vod_play_from = '蝴蝶·' + siteKey.toUpperCase()
            detModel.vod_play_url = entries.join('#')
            backData.data = detModel
        } catch (error) {
            backData.error = '获取影片详情失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 播放

    /**
     * 获取播放地址。args.url 形如 "<siteKey>@@<realId>@@<encodeURIComponent(播放参数)>"。
     * @param {UZArgs} args
     * @returns {Promise<RepVideoPlayUrl>}
     */
    async getVideoPlayUrl(args) {
        let backData = new RepVideoPlayUrl()
        try {
            let raw = String((args && args.url) || '').trim()
            // uz 规范里 args.url 就是「剧集链接」本身；万一宿主把「名称$链接」整串递进来，这里兜一下。
            // 链接里的参数都经过 encodeURIComponent，'$' 会被转义成 %24，所以这里不会误伤。
            const firstDollar = raw.indexOf('$')
            if (firstDollar !== -1 && raw.slice(0, firstDollar).indexOf('@@') === -1) {
                raw = raw.slice(firstDollar + 1)
            }
            let siteKey = 'cj'
            let realId = raw
            let epTarget = raw
            if (raw.indexOf('@@') !== -1) {
                const parts = raw.split('@@')
                siteKey = parts[0]
                realId = parts[1]
                if (parts.length >= 3) {
                    epTarget = decodeURIComponent(parts[2])
                }
            }

            let cleanId = realId
            if (cleanId.indexOf('/') !== -1 && cleanId.indexOf('http') !== 0) {
                const segs = cleanId.replace(/\/+$/, '').split('/')
                cleanId = segs[segs.length - 1].replace('.html', '')
            }

            // 原版：优先用选集里的 ep_target 作为 play 请求标识
            const epTargetLooksLikeParam =
                epTarget.indexOf('http') === 0 ||
                epTarget.indexOf('-') !== -1 ||
                epTarget.indexOf('|') !== -1 ||
                epTarget.indexOf('@') !== -1
            const playParam = epTargetLooksLikeParam ? epTarget : cleanId

            const playApi = (id) => kBase + '/api/v1/spiders/' + siteKey + '/play?id=' + encodeURIComponent(id)

            let r = await this.get(playApi(playParam))
            let playJson = parseJsonData(r.data)

            // ADAPT：后端对无法识别的 id 会把入参**原样回显**。
            // 实测 b8xx6：play?id=<网址> 会原样返回那个网址（于是拿到一个网页地址，播放必然失败），
            // 而 play?id=<裸数字> 才返回真正的 HLS 代理地址。
            // 原版的候选判定在这类「影片 id 是网址、选集 id 才是播放参数」的站点上会选错，
            // 所以在确认「返回的就是我们自己发过去的参数」之后，用另一个候选再试一次。
            if (playJson && playJson.url && String(playJson.url).trim() === playParam) {
                const alt = playParam === epTarget ? cleanId : epTarget
                if (alt && alt !== playParam) {
                    const r2 = await this.get(playApi(alt))
                    const j2 = parseJsonData(r2.data)
                    if (j2 && j2.url && String(j2.url).trim() !== alt) {
                        r = r2
                        playJson = j2
                    }
                }
            }

            let finalUrl = epTarget
            let headerDict = { 'User-Agent': kUa, Referer: kBase + '/' }
            let needParse = 0

            if (playJson) {
                if (playJson.url) {
                    finalUrl = String(playJson.url).trim()
                }
                // 原版：严格透传后端 header（含 x-aggr-sig 防盗链签名）
                if (playJson.header && typeof playJson.header === 'object' && !playJson.header.length) {
                    for (const hk in playJson.header) {
                        headerDict[hk] = playJson.header[hk]
                    }
                }
                const p = parseInt(playJson.parse, 10)
                needParse = p ? p : 0
            }

            // 原版对初8影视与喜福短剧的专属 Referer
            if (siteKey === 'cj') {
                headerDict['Referer'] = 'https://cjysw.cc/'
            }
            if (siteKey === 'xifu') {
                headerDict['Referer'] = 'https://minidrama.contentchina.com/'
            }

            // 原版：相对路径补齐聚合站域名
            if (finalUrl.indexOf('/api/v1/spiders/') === 0) {
                finalUrl = kBase + finalUrl
                needParse = 0
            }
            // 原版：标准音视频流直接放行
            if (isVideoUrl(finalUrl) || hasAudioExt(finalUrl)) {
                needParse = 0
            }

            backData.headers = headerDict
            if (needParse !== 0) {
                // ADAPT：TVBox 的 parse=1 需要挂解析器，uz 没有这个机制，
                // 用 uz 的嗅探对象表达（官方多个扩展都是这么处理的）。
                backData.sniffer = { url: finalUrl, ua: kUa }
                backData.data = ''
            } else {
                backData.data = finalUrl
            }
        } catch (error) {
            backData.error = '获取播放地址失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 搜索

    /**
     * 搜索：原版串行请求 12 个健康源站，每站取前 4 条，且只支持第 1 页。
     * @param {UZArgs} args
     * @returns {Promise<RepVideoList>}
     */
    async searchVideo(args) {
        let backData = new RepVideoList()
        try {
            const kw = String((args && args.searchWord) || '').trim()
            if (!kw) {
                return JSON.stringify(backData)
            }
            const page = (args && args.page) || 1
            if (page > 1) {
                return JSON.stringify(backData)
            }

            let list = []
            for (let i = 0; i < kSearchTargets.length; i++) {
                const skey = kSearchTargets[i]
                const url =
                    kBase + '/api/v1/spiders/' + skey + '/search?wd=' + encodeURIComponent(kw) + '&pg=1'
                const r = await this.get(url, null, kSearchReceiveTimeout)
                const data = parseJsonData(r.data)
                const items = (data && data.list) || []
                for (let j = 0; j < items.length && j < 4; j++) {
                    const item = items[j] || {}
                    const vid = String(item.id || item.vod_id || '')
                    if (!vid) {
                        continue
                    }
                    let model = new VideoDetail()
                    model.vod_id = skey + '@@' + vid
                    model.vod_name = '[' + skey.toUpperCase() + '] ' + (item.name || item.vod_name || '')
                    model.vod_pic = this.universalPic(skey, item.pic || item.vod_pic || '')
                    model.vod_remarks = this.formatRemarks(kBrand, item.remarks || item.vod_remarks || '')
                    list.push(model)
                }
            }
            backData.data = list
            backData.total = list.length
        } catch (error) {
            backData.error = '搜索失败～' + error.message
        }
        return JSON.stringify(backData)
    }

    //MARK: - 内部工具

    /** 原版 _get_spiders_for_plat：取某个大类下的站点，短剧按原版优先级排序 */
    platSites(platId) {
        let out = []
        for (const key in kSites) {
            const info = kSites[key] || {}
            if (platId === 'all' || info.platform === platId) {
                out.push(key)
            }
        }
        if (platId === 'short') {
            out.sort(function (a, b) {
                const ia = kShortPriority.indexOf(a)
                const ib = kShortPriority.indexOf(b)
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
            })
        }
        return out
    }

    /** 取站点的分类列表 */
    catsOf(siteKey) {
        const info = kSites[siteKey]
        if (!info) {
            return []
        }
        return info.categories || []
    }

    /** 从 args.url / type_id 里取出站点 key，兼容原版的 site/<key>/cat/<v> 协议 */
    siteKeyOf(u) {
        let s = String(u || '').trim()
        const m = s.match(/^https?:\/\/[^\/]+(\/[\s\S]*)?$/i)
        if (m) {
            s = m[1] || '/'
        }
        s = s.replace(/^\/+/, '')
        if (s.indexOf('site/') === 0) {
            const rest = s.slice(5)
            const cut = rest.indexOf('/')
            return cut === -1 ? rest : rest.slice(0, cut)
        }
        return s
    }

    /** 原版 _universal_pic：图床白名单直连，其余走官方图片代理 */
    universalPic(siteKey, rawPic) {
        let pic = rawPic === undefined || rawPic === null ? '' : String(rawPic).trim()
        if (!pic) {
            // 原版这里给 dummyimage 占位图；uz 会用自己的占位图，返回空更稳。
            return ''
        }
        // 原版对初8影视(cj)相对图片路径的修复
        if (siteKey === 'cj' && pic.indexOf('/upload/') === 0) {
            return 'https://cjysw.cc' + pic
        }
        if (pic.indexOf('//') === 0) {
            pic = 'https:' + pic
        } else if (pic.indexOf('/') === 0 && pic.indexOf('/api/') !== 0) {
            pic = kBase + pic
        }
        for (let i = 0; i < kDirectPicHosts.length; i++) {
            if (pic.indexOf(kDirectPicHosts[i]) !== -1) {
                return pic
            }
        }
        return kBase + '/api/v1/spiders/' + siteKey + '/proxy?type=img&url=' + encodeURIComponent(pic)
    }

    /** 原版 _format_remarks */
    formatRemarks(brand, meta) {
        const clean = String(meta === undefined || meta === null ? '' : meta)
            .replace(/[\r\n\t]+/g, ' ')
            .trim()
        return clean ? brand + ' | ' + clean : brand
    }

    /** 统一请求出口 */
    async get(url, extraHeaders, receiveTimeout) {
        try {
            const options = {
                headers: Object.assign(
                    { 'User-Agent': kUa, Referer: kBase + '/', Accept: '*/*' },
                    extraHeaders || {}
                ),
            }
            if (receiveTimeout) {
                options.receiveTimeout = receiveTimeout
            }
            const pro = await req(url, options)
            return { code: pro.code, data: pro.data, error: pro.error || '' }
        } catch (e) {
            return { code: -1, data: '', error: e.message }
        }
    }
}

var yiguoduan2026 = new yiguoduanClass()
