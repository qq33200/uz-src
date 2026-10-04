// ignore
//@name:蝴蝶·成人卡通
//@webSite:https://www.cartoonporno.cc
//@version:1
//@remark:CartoonPorno（cartoonporno.cc）TVBox py 源移植。7 个一级分类 + 排序/746 个分类筛选面板 + 站内搜索；详情页直接给出正片直链。两处按实测做的加固：① 修正原版卡片解析的错位 bug（原版按 img[data-vid] 切块，把 a[title] 甩到前一块，导致 vid 与标题/详情路径错开一格、点进去是别的片）；② 播放直链实测约 1/3 概率随机 403（服务端多节点抖动，同一地址重试即可，重取详情换签名反而更差 67%→58%），故播放时并行预检 3 路，成功率 67%→97%。播放头必须带 Referer（不带的话服务端只回一个 10 秒的提示流 tip.ts）。原版的域名自愈源头（x99dh.* 导航站）已失效（现全 500 或跳广告页），故以 cartoonporno.cc 为主域名并保留自愈兜底。v1。
//@order: J
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

import { UZUtils, ProData, ReqResponseType, ReqAddressType, req, getEnv, setEnv, toast } from '../../core/uzUtils.js'

import { cheerio, Crypto, Encrypt, JSONbig } from '../../core/uz3lib.js'
// ignore

/**
 * 蝴蝶·成人卡通（CartoonPorno）—— TVBox py 源 → uz 视频源扩展
 *
 * 原链路（照抄）：
 *   分类   homeContent      → 7 个一级分类 + 排序 / 746 个分类筛选
 *   列表   categoryContent  → /videos?hl=zh&page=N 或 /<categories/168/xxx/>?hl=zh&page=N
 *   详情   detailContent    → 详情页里 <source src> 就是正片直链
 *   播放   playerContent    → 直链 + Referer（不带 Referer 会拿到 10 秒提示流）
 *   搜索   searchContent    → /search?q=xx&hl=zh
 *
 * 与 py 原版的三处差异（都是实测驱动，见每个函数上的注释）：
 *   ① 卡片解析按 <a data-i=...> 切块（原版按 <img data-vid=> 切，导致 vid/title/path 错位）
 *   ② 播放时并行预检 3 路 + 失败重取详情（原版只回直链，实测 33% 概率 403）
 *   ③ 域名自愈源头已失效，改为主域名直连 + 自愈兜底
 */

//MARK: - 常量

const appConfig = {
    ver: 1,
    webSite: 'https://www.cartoonporno.cc',
    ua:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    brand: '蝴蝶影视',
    tg: 'https://t.me/tvshare23',
    siteName: 'CartoonPorno',
    siteAlias: '免费精品动漫卡通视频',
    pageSize: 50,
}

/** 备用域名（实测：只有 www 与裸域可用，裸域会 301 到 www） */
const cpHosts = ['https://www.cartoonporno.cc', 'https://cartoonporno.cc']

/** 原版的域名自愈导航站。实测 2026-10-04：全部 500 或跳广告页，故仅作兜底保留 */
const cpNavUrls = [
    'https://x99dh.vip',
    'https://x99dh.my',
    'https://x99dh.cc',
    'https://x99dh.one',
    'https://x99dh.top',
]

const cpTimeout = 12000
const cpProbeTimeout = 9000
/** 播放直链预检：并行几路（实测单次成功率 ~67%，3 路 ≈ 97%） */
const cpProbeRounds = 3

/** 详情页里这些是预览片花，不是正片 */
const cpPreviewMarks = ['p320-180.mp4', 'preview', 'sample', 'trailer']

let cpHealedHost = ''
let cpHealTask = null
let cpDetailCache = {}

/**
 * 分类表（原版 RAW_ALL_CATS 压平成 "名称|route" 行）
 *
 * route 在表里省掉了固定的 `categories/` 前缀（746 项省下约 8KB），运行时补回来。
 */
const cpCatPrefix = 'categories/'

const cpRawCats =
    '3D性感|217/3d\n动漫色情|447/hentai\n娇小性感|583/petite\n3D卡通诱惑|218/3d-cartoon\n扶她激情|407/futanari\n浴缸暧昧|250/bath\n无码直击|725/uncensored\n欲火焚身|458/horny\n老爹角色|352/daddy\n漫画风情|197/manga\n动漫诱惑|231/anime\n处女初体验|739/virgin\n叔叔禁忌|726/uncle\n制服诱惑|730/uniform\n捆绑调教|254/bdsm\nAngels|183/angels\n精灵宝可梦|94/pokemon\n疯狂性爱|337/crazy\n迪士尼风|33/disney\n青春少女|700/teen\n丝袜诱惑|678/stockings\n学生妹子|684/student\n可爱小骚|222/adorable\n手动快感|444/handjob\n奴隶调教|658/slave\n巨屌猛男|266/big-cock\nGiants|170/giants\n大屌|321/cock\n病人角色|579/patient\n小穴|605/pussy\n孕妇|595/pregnant\n群交狂欢|569/orgy\n毛绒性癖|406/furry\n后庭猛插|235/assfucking\n肥胖身材|384/fat\n非亲妹妹|549/not-sister\n青春肉体|761/young\n巨乳诱惑|268/big-tits\nAnimations|185/animations\n亚洲风情|233/asian\n双重插入|365/double-penetration\n家庭乱伦|5/family\n性爱游戏|409/game\n舔屁眼|620/rimjob\n修长美腿|493/legs\n继母诱惑|13/stepmom\n可爱妹子|351/cute\n成熟风韵|514/mature\n丰满胸部|708/tits\n口交快感|276/blowjob\n体内射精|338/creampie\n性感妈咪|530/mommy\n生化危机|46/resident-evil\n性感诱惑|643/sexy\n激烈做爱|404/fucking\n非亲儿子|550/not-son\n奶奶风韵|431/grandmother\n绝色美女|257/beautiful\n家庭主妇|461/housewife\n舔弄快感|496/lick\n老男人魅力|563/old-man\n激烈硬核|445/hardcore\n老奶奶欲|432/granny\n禁忌刺激|692/taboo\n后门快感|229/anal\n情人激情|503/lover\n赤裸诱惑|538/naked\n学生妹|632/schoolgirl\n粗暴干法|624/rough\n医生扮演|361/doctor\n医院情欲|459/hospital\n自制激情|454/homemade\n34号规则|69/rule-34\n满口快感|533/mouthful\n性感熟女|519/milf\n激情四射|578/passionate\n淫水直流|370/dripping\n户外野性|571/outdoor\n紧致身材|706/tight\n第一次体验|391/first-time\n哥特风情|429/goth\n朋友开房|403/friend\n美胸晃动|282/boobs\n酒店私密|460/hotel\n健身性爱|394/fitness\n圣诞性感|309/christmas\n震动快感|737/vibrator\n偷窥刺激|740/voyeur\nOne Piece|162/one-piece\n娇小胸部|663/small-tits\n老板调戏|285/boss\n健身房欲|435/gym\n乳汁喷射|521/milk\n气球性感|245/balloon\n警察制服|589/police\n老师诱惑|699/teacher\n露肉挑逗|395/flashing\n潮吹高潮|676/squirting\n成熟女士|486/lady\n短裙撩人|656/skirt\n纹身诱惑|697/tattoo\n液体狂欢|499/liquid-lunch\n热吻缠绵|483/kissing\n渔网装诱惑|392/fishnets\n私人空间|599/private\n多汁诱人|479/juicy\n短发辣妹|647/short-hair\n丰满身材|350/curvy\n劳拉·克劳馥|29/lara-croft\n两女一男|388/ffm\n全裸诱惑|551/nude\n换妻狂欢|690/swingers\n完整影片|405/full-movie\n湿滑小穴|747/wet-pussy\n私处特写|258/beaver\n新娘诱惑|290/bride\n打屁股戏|671/spanking\n色情诱惑|376/erotic\n射精|343/cum\n人妖风情|718/transsexual\n面部射精|381/facial\n私处特写|736/vagina\n角色扮演|621/roleplay\n大臀翘臀|263/big-ass\n口交窒息|408/gagging\n紧窄小穴|707/tight-pussy\n现场秀|10/show\n偷窥|743/watching\n捆绑束缚|280/bondage\n性爱机器|505/machine\n宝贝性感|242/babe\n熟女猎手|332/cougar\n黑人辣妹|274/black\nDemons|180/demons\n顺从调戏|687/submissive\n沙滩风情|255/beach\n极端玩法|380/extreme\n怪物奇趣|531/monster\n婚礼性爱|745/wedding\nFictional Characters|174/fictional-characters\n假阳具戏|680/strapon\n女主支配|386/femdom\n泳池激情|591/pool\n色情明星|592/pornstar\n侧身热辣|651/sideways\n纤细腰肢|664/small-waist\n精选合集|329/compilation\n吞精诱惑|689/swallow\n邻家女孩|419/girl-next-door\n伪娘诱惑|206/femboy\n女同性恋|494/lesbian\n眼镜诱惑|423/glasses\n自慰高潮|513/masturbation\n纤瘦尤物|655/skinny\n绿帽癖|341/cuckold\n老熟风韵|561/old\n群交狂欢|410/gangbang\n黑肤辣妹|372/ebony\n偷情|305/cheating\n人妻|751/wife\n意外性爱|221/accident\n人妖魅惑|487/ladyboy\n自慰快感|476/jerking-off\n比基尼性感|270/bikini\n人妖魅惑|646/shemale\n日本风情|474/japanese\n搞笑模仿|576/parody\n翘臀诱惑|234/ass\n高潮爆发|568/orgasm\n淘气挑逗|542/naughty\n大学风骚|324/college\n跨种族激情|470/interracial\n公共场所|601/public\n巨根震撼|532/monster-cock\n羞辱快感|463/humiliation\n伪娘|3/sissy\n后入式|362/doggystyle\n老少配对|562/old-and-young\n机器人性爱|19/robot\n异装癖|339/crossdressing\n模拟人生|23/sims\n张开诱惑|411/gaping\n漫画风|327/comic\n深喉口交|354/deepthroat\n窒息快感|308/choking\n黑人大屌|264/big-black-cock\n修女禁忌|553/nun\n精灵诱惑|192/elf\n传教士体位|524/missionary\n森林野战|402/forest\n情趣玩具|716/toys\n复古风情|616/retro\n内射阴道|345/cum-in-pussy\n口交快感|567/oral\n男同热恋|414/gay\n源代码动画|68/sfm\n拳交|393/fisting\n外星人奇遇|225/alien\n口交快感|688/sucking\n感官享受|640/sensual\n手指插入|390/fingering\n呻吟销魂|527/moaning\n纯真诱惑|466/innocent\n黑发辣妹|291/brunette\n性感女仆|506/maid\n复古情色|738/vintage\n性感装扮|572/outfit\n邻居诱惑|544/neighbors\n红发辣妹|613/redhead\n多毛诱惑|441/hairy\n保姆诱惑|243/babysitter\n美国老爸|21/american-dad\n第一人称视角|594/pov\n多人狂欢|434/group\n乡村野战|333/country\n色情按摩|510/massage\n圆润翘臀|293/bubble-butt\n性幻想|382/fantasy\n一对一|11/1on1\n变态玩法|482/kinky\n多人颜射|294/bukkake\n水族性感|26/aqua\n巨大震撼|462/huge\n书呆子性感|545/nerd\n护士诱惑|554/nurse\n双性恋混战|273/bisexual\n乳头挑逗|547/nipples\n双人玩法|364/double\n已婚偷情|508/married\n分享激情|644/share\n支配调教|363/domination\n浪漫氛围|622/romantic\n指导调教|468/instruction\n放荡骚货|661/slut\n凌乱狂野|660/sloppy\n舔阴|348/cunilingus\n湿润诱惑|746/wet\n丰满尤物|253/bbw\n骑乘快感|619/riding\n真实体验|612/reality\n太空激情|54/space\n独秀自慰|669/solo\n乳交快感|709/titty-fuck\n女上位|336/cowgirl\n阴唇特写|606/pussy-lips\n足部恋|385/feet\n迷你短裙|522/miniskirt\n节日狂欢|452/holiday\n性工作者|600/prostitute\n胸上射精|347/cum-on-tits\n内裤诱惑|574/panties\n特殊癖好|387/fetish\n办公室激情|559/office\n舔阴狂热|534/muff-diving\n老公偷情|465/husband\n脸上射精|346/cum-on-face\n车震|299/car\n古铜肌肤|695/tanned\n尖叫高潮|635/screaming\n光滑无毛|645/shaved\n暗室口交|424/gloryhole\n尼龙性感|556/nylon\n全能戏剧|76/total-drama\n拉伸挑逗|682/stretching\n乳胶紧身|489/latex\n菊花紧致|236/asshole\n沐浴性感|251/bathing\n性感内衣|497/lingerie\n男友偷欢|288/boyfriend\n漂亮妹子|596/pretty\n拍打刺激|657/slap\n大胸妹|1/oppai\n连裤袜性感|575/pantyhose\n厕所偷情|711/toilet\n龙珠|52/dragon-ball\n快速干炮|608/quickie\n监狱风|598/prison\n天然美胸|540/natural-tits\n春野樱|125/sakura-haruno\n角色扮演|331/costumes\n街头激情|681/street\n丰满阴部|267/big-pussy\n肌肉猛男|535/muscular\n教室激情|316/classroom\n勾引挑逗|637/seduction\n臀部游戏|237/assplay\n厨房激情|484/kitchen\n派对狂热|577/party\n透视诱惑|638/see-through\n女生接吻|421/girls-kissing\n农场激情|610/ranch\n守望先锋|44/overwatch\n上班偷欢|240/at-work\n假阳具|358/dildo\n自慰指导|477/jerk-off-instructions\n情侣性爱|334/couple\n小公主|597/princess\n男男热恋|204/yaoi\n风骚婊子|750/whore\n搅拌机动画|67/blender-animation\n床上缠绵|259/bed\n内衣诱惑|728/underwear\nLeague of Legends|164/league-of-legends\n张开诱惑|674/spreading\n丰满肉感|208/thick\n紧身裤诱惑|492/leggings\n秘书诱惑|636/secretary\n运动型男|239/athletic\n万圣节欲|442/halloween\n放屁癖|383/farting\nHeroes|158/heroes\n拉丁辣妹|490/latina\nDC漫画|40/dc-comics\n卧室激情|260/bedroom\n软色挑逗|668/softcore\n高跟性感|446/heels\n敏感小豆|317/clit\n性爱打斗|389/fight\n瑜伽性爱|760/yoga\n完美身材|581/perfect-body\n前戏挑逗|401/foreplay\n情绪化妹子|374/emo\n小腹诱惑|262/belly\n无毛诱惑|438/hairless\n舌头挑逗|712/tongue\nMarvel|161/marvel\n饱满诱惑|602/puffy\n最终幻想|66/final-fantasy\n下垂奶子|627/saggy-tits\n食物性戏|399/food\n女友私密|417/girlfriend\n捆绑快感|705/tied-up\n火影激情|198/naruto\n偷窥刺激|675/spying\n小巧阳具|662/small-cock\nSuccubus|179/succubus\nVillains|167/villains\n男主支配|507/maledom\n浴室偷情|252/bathroom\n死或生|50/dead-or-alive\nD.Va|124/d.va\n脱衣诱惑|683/striptease\n蒂法·洛克哈特|117/tifa-lockhart\n女女激情|420/girl-on-girl\n传奇故事|70/legend\n性感模特|528/model\n被骗上床|720/tricked\n访谈挑逗|471/interview\n女王驾到|202/queen\n金发尤物|275/blonde\n大嘴骚货|4/big-mouth\n抖臀挑逗|238/ass-shaking\n牛仔热辣|475/jeans\n高个子|693/tall\n阳具挑逗|580/penis\n健身性爱|752/workout\n乳头穿孔|585/pierced-nipples\n身体穿孔|586/piercing\n神奇女侠|31/wonder-woman\n安全套play|330/condom\n粪便癖好|211/scat\n害羞挑逗|649/shy\n网络摄像头|744/webcam\n丰满肉感|310/chubby\n偷拍刺激|448/hidden\n七大罪|88/seven-deadly-sins\n娜美|128/nami\n热舞诱惑|353/dancing\n柔体性感|397/flexible\n性瘾狂热|557/nympho\n手铐诱惑|443/handcuffs\n鞭打调教|749/whipping\n兔女郎|295/bunny\n阿狸|126/ahri\n日向雏田|131/hinata-hyuga\n淫荡刺激|539/nasty\n香蕉挑逗|246/banana\n黄瓜自慰|342/cucumber\n修剪私处|721/trimmed-pussy\n被剥削|379/exploited\n69互玩|219/69\n性爱竞赛|328/competition\n猛男干将|195/fuckerman\n塞尔达传说|71/the-legend-of-zelda\n超级马里奥|84/super-mario\n情妇调教|525/mistress\n南方公园|22/south-park\n兽人狂热|14/orcs\n意外暴露|566/oops\n走错洞了|756/wrong-hole\n天使|136/mercy\n抖奶诱惑|287/bouncing-boobs\n星球大战|38/star-wars\n蒙面刺激|509/masked\n我的英雄学院|73/my-hero-academia\nThe Incredibles|177/the-incredibles\n另类玩法|227/alternative\n人妖诱惑|9/trap\n碧蓝航线|60/azur-lane\n射精高潮|478/jizz\n强迫play|7/forced\n亲爱的弗兰克斯|48/darling-in-the-franxx\n零二|132/zero-two\nSonic|176/sonic\n啦啦队长|306/cheerleader\n长发诱惑|500/long-hair\n名人色情|36/famous\n性感女神|426/goddess\n按摩浴缸|473/jacuzzi\nDragons|182/dragons\n挺翘诱人|582/perky\n互动性爱|469/interactive\n这个美好的世界|62/konosuba\n少年泰坦|80/teen-titans\n游艇激情|759/yacht\n女尊男卑|302/cfnm\n雨中狂热|55/rain\n放松一下|614/relax\n粗暴性爱|292/brutal\n猛烈抽插|369/drilled\n裙底风光|734/upskirt\n入室盗贼|296/burglar\n体操性感|436/gymnast\n木乃伊性感|12/mummy\n交叉磨蹭|633/scissoring\n捆绑包裹|753/wrapped-bondage\n少年骇客|77/ben-10\n沙滩野战|256/beach-sex\n一拳超人|81/one-punch-man\n龙卷（恐怖龙卷）|112/tatsumaki-(tornado-of-terror)\n银河战士|61/metroid\n月下狂欢|200/moon\n傻白甜骚货|271/bimbo\n两男一女|526/mmf\n丧尸激情|16/zombie\nDeath|172/death\n镜前激情|523/mirror\n水手装诱惑|628/sailor\n主人调教|512/master\n街头勾引|456/hooker\n走运艳遇|504/lucky\n脱衣挑逗|729/undressing\n刀剑神域|64/sword-art-online-(sao)\n臣服快感|686/submission\n涂油滑腻|560/oiled\n出租车激情|698/taxi\n布尔玛|138/bulma\n自然野性|541/nature\n丁字裤诱惑|704/thong\n摔跤性爱|754/wrestling\n火焰纹章|86/fire-emblem\n惊艳性感|228/amazing\n名人艳照|301/celebrity\n死神|85/bleach\n运动热辣|673/sport\n摩擦挑逗|433/grinding\n大学风骚|731/university\n鬼灭之刃|83/demon-slayer\n胡蝶忍|105/shinobu-kocho\n斯普拉遁|82/splatoon\nGriffins|186/griffins\n斩服少女|87/kill-la-kill\n龙子杀生丸|99/ryuko-matoi\n玛丽·萝丝|135/marie-rose\n牙套妹子|289/braces\n修长玉腿|501/long-legs\n影院偷欢|313/cinema\n晒痕性感|694/tan-lines\n丑女反差|724/ugly\n复仇性爱|617/revenge\n酒吧激情|247/bar\n同学情欲|315/classmate\n性感魅力|422/glamour\n亲密接触|472/intimate\n阿姨风骚|241/aunt\n受罚调教|603/punished\nX战警|79/x-men\n瑞克和莫蒂荒唐|212/rick-and-morty\n摆姿势|593/posing\n尼尔机械纪元|45/nier-automata\n哺乳诱惑|485/lactating\n怪诞小镇|43/gravity-falls\n正义联盟|25/justice-league\n书呆子骚气|283/bookworm\n紧身短裤|648/shorts\n鲍赛特|109/bowsette\n性感裙装|368/dress\n祢豆子|110/nezuko\nClowns|171/clowns\n小丑扮演|320/clown\n醉酒性爱|371/drunk\n瑞雯|113/raven\n堡垒之夜|65/fortnite\n野狼欲望|216/wolf\n沙漠热浪|59/sand\n老女人风情|564/old-woman\n东方风情|570/oriental\nFamily Guy|152/family-guy\n意外翻车|427/goes-wrong\n列车激情|717/train\n兽人狂野|205/yiff\nErza Scarlet|143/erza-scarlet\n肿胀私处|691/swollen-pussy\n史酷比风|6/scooby-doo\n阿卡丽KDA|107/akali-kda\n超人幻想|17/superman\nAvengers|165/avengers\n异国风情|400/foreign\n手套性感|425/gloves\n自舔快感|639/self-sucking\n磨豆腐快感|719/tribbing\n熟睡偷窥|659/sleeping\n双胞胎诱惑|723/twins\n瓶子挑逗|286/bottle\n阳光下的刺激|56/sunny\n萨姆斯·艾兰|141/samus-aran\n哈莉奎茵性感|207/harley-quinn\n爱丽丝·盖恩斯巴勒|114/aerith-gainsborough\n阿凡达风|39/avatar\n科拉传奇|75/korra\n蝙蝠侠幻想|30/batman\n冒险时光|74/adventure-time\n克莱尔·雷德菲尔德|120/claire-redfield\n红白黑黄|49/rwby\n露西·哈特菲莉亚|106/lucy-heartfilia\nFairytale|173/fairytale\n头套玩法|455/hood\n纲手|121/tsunade\n卷发妹|349/curly\nTitans|169/titans\nSpider Man|154/spider-man\nMetal|189/metal\n脱衣诱惑|318/clothes-off\n黄金雨癖|428/golden-shower\n生日狂欢|272/birthday\n女上男下|418/girl-fucks-guy\n按摩女郎|511/masseuse\n长靴诱惑|284/boots\n街头搭讪|584/pickup\n霞|137/kasumi\nValkyrie|178/valkyrie\n超级英雄|32/superhero\n结城明日奈|119/asuna-yuuki\n裸体主义者|552/nudist\n花园性爱|412/garden\nLadybug|187/ladybug\n史莱姆诱惑|58/slime\n跪地诱惑|565/on-her-knees\n巧克力涂身|307/chocolate\n表亲禁忌|335/cousin\n野兽交|37/beast\n吉尔·瓦伦丁|122/jill-valentine\nGreen Lanterns|184/green-lanterns\n哈利波特魔法欲|203/harry-potter\n恶魔高校|63/high-school-dxd\nAkeno Himejima|142/akeno-himejima\n无性爱挑逗|548/no-sex\n香黛|51/shantae\n笼子play|298/cage\n真实感|2/realistic\n星火|98/starfire\nSuperpowers|153/superpowers\n真人快打|35/mortal-combat\n巨乳幻想|41/kyonyuu-fantasy\n性感脚趾|710/toes\n皮革性感|491/leather\n芭蕾舞女郎|244/ballerina\n忍者神龟|92/turtles-ninja\n富豪玩法|618/rich\n极品少女|757/xs-girls\n羞辱玩法|360/disgrace\nPony|160/pony\n露比·罗丝|134/ruby-rose\n两女一男|517/mff\n双马尾萌系|587/pigtails\n丑闻曝光|630/scandal\nProfessor|150/professor\n全洞开发|226/all-holes\n18号安卓|116/android-18\n屋顶激战|623/rooftop-sex\n雪地激情|667/snow\n凌乱性爱|516/messy\n大胸诱惑|457/hooters\n丰满大胸|515/melons\n湿身T恤|748/wet-t-shirt\n上空诱惑|713/topless\n独家内容|377/exclusive\n纤细美男|722/twink\n紧身弹力|670/spandex\n超女诱惑|18/superwoman\n电梯激情|373/elevator\n阿拉伯之夜|27/arabian-nights\n马尾俏皮|590/ponytail\n多彩性爱|325/colorful\n马兽癖|8/horse\n兔女郎热舞|194/rabbit\n兔子玩具|609/rabbit-toy\n军装激情|232/army\nHulk|156/hulk\n未来世界|53/future\n时尚性感|685/stylish\n猛男诱惑|464/hunk\n插入刺激|467/insertion\n机车辣妹|269/biker\n辛普森风|20/simpsons\n丰满肉感|588/plump\nDeadpool|151/deadpool\n淫荡脏污|359/dirty\n爷爷性爱|430/grandfather\n音乐助兴|536/music\n拉头发戏|439/hair-pulling\n梦中情人|367/dream-girl\n口红诱惑|498/lipstick\n赤脚诱惑|248/barefoot\n美人鱼诱惑|28/mermaid\n橡胶情趣|625/rubber\n经典老片|314/classic\n尿布癖|357/diaper\n艾达·王|129/ada-wong\n剧情性爱|679/storyline\n自慰快感|741/wanking\n游客艳遇|715/tourist\n维奥莱特·帕尔|104/violet-parr\n狼人狂暴|215/werewolf\n怪异刺激|210/weird\n井上织姬|103/orihime-inoue\n奇幻仙境|196/wonderland\n未来家庭|72/futurama\nBender|145/bender\n香烟挑逗|312/cigarette\n抽烟性感|665/smoking\nEvils|181/evils\n布莱克·贝拉多娜|123/blake-belladonna\n送货小哥|355/delivery-boy\n疼痛快感|573/pain\n变性美女|702/tgirl\n汤姆与杰瑞|90/tom-and-jerry\nUniversal Pictures|163/universal-pictures\n丛林野性|481/jungle\n黛米|118/demi\n互相自慰|537/mutual-masturbation\n公交车|297/bus\n黑影|133/sombra\n尼尔2B型|127/yorha-no-2-type-b\nPhilip J Fry|147/philip-j-fry\n贫民区风|415/ghetto\n船上激情|277/boat\n贴身热舞|488/lap-dance\n淫荡骚气|611/raunchy\n瞳|115/hitomi\nWarcraft|191/warcraft\n甜蜜糖果|209/candy\n摩登原始人|24/flintstones\n吊带性感|413/garter-belt\n小穴拉伸|607/pussy-stretching\n屁股被干爆|356/destroyed-ass\n双阴插入|366/double-vaginal\n前女友|378/ex-girlfriend\n街头流浪|453/homeless\n嬉皮风骚|449/hippy\n努鲁按摩|555/nuru-massage\n教堂禁忌|311/church\n性爱告白|642/sex-confessions\n猫咪打架|300/catfight\n德克斯特|93/dexter\n吉普赛风|437/gypsy\n娇小身材|518/midget\n军装诱惑|520/military\n肉棒崇拜|323/cock-worship\n愤怒性爱|230/angry\n发型性感|440/hairstyle\n女主支配|495/lezdom\n弓箭手激情|213/archer\nAyane|144/ayane\n朋克风|604/punk\n衣服撕裂|319/clothes-ripped\n真空吸力|735/vacuum\n强势猛干|223/aggressive\n窒息快感|666/smother\n肌肉猛男|278/bodybuilder\n空姐制服|677/stewardess\nTwisted|188/twisted\n抓痕刺激|634/scratches\nGuardians of the Galaxy|166/guardians-of-the-galaxy\n高雄|100/takao\n肥胖诱惑|558/obese\nCosmo Boy|168/cosmo-boy\n希尔达|78/hilda\n地下室私密|249/basement\nSoldiers|190/soldiers\n超大尺寸|758/xxl\n哭泣快感|340/crying\n搞笑性感|654/silly\n巫师|47/the-witcher\n希里|130/ciri\n金·波塞尔|101/kim-possible\nMinions|175/minions\n缎面性感|629/satin\n空中性爱|398/flight\n老鼠癖|34/mouse\n跳动巨乳|480/jumping-tits\n恶魔诱惑|214/deamons\n紧张刺激|546/nervous\n美少女战士|201/sailor-moon\n大恶司女战士猎手|42/daiakuji-the-xena-buster\n窥阴器趣|672/speculum\n施虐快感|626/sadism\n灌肠玩法|375/enema\n水下激情|727/underwater\n硅胶丰满|652/silicone\n叶妮芙|139/yennefer\n搞笑色情|326/comedy\n皱纹熟女|755/wrinkled\nLeela|146/leela\n修理工诱惑|615/repairman\n射后放屁|344/cum-farting\n精准挑逗|696/targeted\n妈妈与少年|529/mom-and-boy\nAmy Wong|148/amy-wong\n大阴蒂诱惑|265/big-clit\n仓库偷情|742/warehouse\n诗乃（朝田诗乃）|96/sinon-(asada-shino)\n三星小助手Sam|111/samsung-sam\n平胸诱惑|396/flat-chested\n海绵宝宝|89/sponge-bob\n布雷默顿|108/bremerton\n废弃老屋激情|220/abandoned-house\n外星飞船|57/ufo\n丝滑诱惑|653/silk\n阴茎环|322/cock-ring\n啤酒助兴|261/beer\n爱宕|140/atago\n骷髅魅影|193/skeleton\n捆绑紧缚|451/hogtied\n身体彩绘|279/body-painting\n触手怪戏|701/tentacle\n性爱狂欢|641/sex\n科琳|102/corrin\n学生弟弟|631/schoolboy\n小偷被抓|703/thief-caught\n机场偷情|224/airport\nOther Planet|157/other-planet\nIron Man|155/iron-man\n梅林|95/merlin\n佩罗娜|97/perona\n长指甲性感|502/long-nails'

function cpAllCats() {
    if (cpAllCats.cache) {
        return cpAllCats.cache
    }
    const out = []
    const lines = cpRawCats.split('\n')
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i]
        if (!ln) {
            continue
        }
        const at = ln.indexOf('|')
        if (at === -1) {
            continue
        }
        out.push({ name: ln.slice(0, at), route: cpCatPrefix + ln.slice(at + 1) })
    }
    cpAllCats.cache = out
    return out
}

/** 一级分类（照搬原版 homeContent） */
function cpTopClasses() {
    return [
        { id: 'videos', name: '全部视频' },
        { id: 'sec_3d', name: '3D精选' },
        { id: 'sec_anime', name: '二次元动漫' },
        { id: 'sec_char', name: '同人角色' },
        { id: 'sec_physique', name: '体态风情' },
        { id: 'sec_roleplay', name: '角色扮演' },
        { id: 'sec_scenes', name: '情境玩法' },
    ]
}

/** 一级分类的默认 route（照搬原版 categoryContent） */
const cpSecRoute = {
    videos: 'videos',
    sec_3d: 'categories/217/3d',
    sec_anime: 'categories/231/anime',
    sec_char: 'categories/117/tifa-lockhart',
    sec_physique: 'categories/268/big-tits',
    sec_roleplay: 'categories/730/uniform',
    sec_scenes: 'categories/679/storyline',
}

/** 原版按关键词把 746 个分类聚成 6 组（照搬） */
const cpKw = {
    sec_3d: ['3d', 'sfm', 'blender', 'overwatch', 'resident-evil', 'final-fantasy', 'dead-or-alive', 'nier', 'zelda', 'fortnite', 'league-of-legends', 'warcraft', 'sims'],
    sec_anime: ['hentai', 'anime', 'manga', 'dragon-ball', 'naruto', 'one-piece', 'bleach', 'demon-slayer', 'one-punch-man', 'pokemon', 'dxd', 'sao', 'azur-lane', 'kill-la-kill'],
    sec_char: ['tifa', 'android-18', 'nami', 'ahri', 'hinata', 'yorha', 'sakura', 'd.va', 'lara', 'ada-wong', 'jill', 'tsunade', 'zero-two', 'nezuko', 'wonder-woman', 'harley', 'bulma', 'asuna', 'aerith', 'samus', 'yennefer', 'ciri', 'bowsette', 'raven', 'mercy', 'shinobu', 'sombra', 'atago', 'corrin'],
    sec_physique: ['petite', 'tits', 'ass', 'legs', 'cock', 'pussy', 'bbw', 'thick', 'skinny', 'fat', 'brunette', 'blonde', 'redhead', 'shaved', 'hairy', 'big-', 'small-', 'tall', 'muscular'],
    sec_roleplay: ['uniform', 'student', 'maid', 'nurse', 'teacher', 'secretary', 'stewardess', 'police', 'bunny', 'housewife', 'stepmom', 'milf', 'nun', 'model', 'babysitter', 'doctor', 'slave', 'costume'],
}

//MARK: - 小工具

function cpToStr(v) {
    if (v === null || v === undefined) {
        return ''
    }
    return String(v)
}

function cpErrText(e) {
    if (!e) {
        return '未知错误'
    }
    if (e.message) {
        return String(e.message)
    }
    return String(e)
}

/** HTML 实体还原（标题里常见 &#39; / &amp; 等） */
function cpHtmlDecode(s) {
    let t = cpToStr(s)
    if (!t || t.indexOf('&') === -1) {
        return t
    }
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#34': '"' }
    t = t.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, g) {
        if (named[g] !== undefined) {
            return named[g]
        }
        if (g.charAt(0) === '#') {
            const hex = g.charAt(1) === 'x' || g.charAt(1) === 'X'
            const n = parseInt(hex ? g.slice(2) : g.slice(1), hex ? 16 : 10)
            if (!isNaN(n) && n > 0 && n < 65536) {
                return String.fromCharCode(n)
            }
        }
        return m
    })
    return t
}

/** 取 HTML 标签属性值（不区分大小写、单双引号都吃） */
function cpAttr(attrs, name) {
    const m = cpToStr(attrs).match(new RegExp(name + '=["\\\']([^"\\\']*)["\\\']', 'i'))
    return m ? m[1].trim() : ''
}

function cpAbs(u) {
    const s = cpToStr(u).trim()
    if (!s) {
        return ''
    }
    if (s.indexOf('//') === 0) {
        return 'https:' + s
    }
    if (s.charAt(0) === '/') {
        return cpSite() + s
    }
    if (!/^https?:\/\//i.test(s)) {
        return cpSite() + '/' + s
    }
    return s
}

/** 手动分块请求（原版 py 是同步阻塞式，JS 里用 req + 超时） */
function cpHeaders(extra) {
    const h = {
        'User-Agent': appConfig.ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
    if (extra) {
        const ks = Object.keys(extra)
        for (let i = 0; i < ks.length; i++) {
            h[ks[i]] = extra[ks[i]]
        }
    }
    return h
}

/** 判成功只看 code（或 ok()）—— 不用 error 判，实测成功时 error 也可能有值 */
async function cpFetch(url, headers, opts) {
    const o = opts || {}
    const options = {
        headers: cpHeaders(headers),
        sendTimeout: o.timeout || cpTimeout,
        receiveTimeout: o.timeout || cpTimeout,
    }
    if (o.range) {
        options.headers.Range = o.range
    }
    let p = null
    try {
        p = await req(url, options)
    } catch (e) {
        return { ok: false, code: -1, text: '', error: '请求异常：' + cpErrText(e) }
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
        return { ok: false, code: code, text: '', error: 'HTTP ' + code + (p && p.error ? '：' + p.error : '') }
    }
    let text = ''
    const d = p && p.data
    if (typeof d === 'string') {
        text = d
    } else if (d && typeof d === 'object' && !(d instanceof ArrayBuffer)) {
        text = JSON.stringify(d)
    } else if (d instanceof ArrayBuffer) {
        // Range 预检用不到正文，这里只在需要时转
        const bytes = new Uint8Array(d)
        let s = ''
        for (let i = 0; i < bytes.length && i < 4096; i++) {
            s += String.fromCharCode(bytes[i])
        }
        text = s
    }
    return { ok: true, code: code, text: text, error: '' }
}

//MARK: - 域名：自愈 + 兜底

function cpSite() {
    return cpHealedHost || appConfig.webSite
}

/** 自愈候选：解析导航站里的 base64 站点清单（照搬原版；实测源头已失效，故必带兜底） */
function cpB64Decode(s) {
    try {
        const bin = typeof atob === 'function' ? atob(s) : ''
        return bin
    } catch (e) {
        return ''
    }
}

async function cpCandidates() {
    const out = []
    for (let i = 0; i < cpNavUrls.length; i++) {
        const nav = cpNavUrls[i]
        const r = await cpFetch(nav, { Accept: '*/*' }, { timeout: 6000 })
        if (!r.ok || !r.text) {
            continue
        }
        const blocks = r.text.match(/["'][A-Za-z0-9+/=]{100,}["']/g) || []
        for (let b = 0; b < blocks.length; b++) {
            const raw = blocks[b].slice(1, -1)
            let dec = ''
            try {
                dec = decodeURIComponent(cpB64Decode(raw))
            } catch (e) {
                continue
            }
            if (dec.indexOf('[') === -1) {
                continue
            }
            if (dec.toLowerCase().indexOf('cartoonporno') === -1 && dec.indexOf(appConfig.siteAlias) === -1) {
                continue
            }
            let list = null
            try {
                list = JSON.parse(dec)
            } catch (e) {
                continue
            }
            if (!(list instanceof Array)) {
                continue
            }
            for (let k = 0; k < list.length; k++) {
                const it = list[k] || {}
                const name = cpToStr(it.name)
                const desc = cpToStr(it.desc)
                if (
                    name.toLowerCase().indexOf('cartoonporno') === -1 &&
                    desc.toLowerCase().indexOf('cartoonporno') === -1 &&
                    name.indexOf(appConfig.siteAlias) === -1 &&
                    desc.indexOf(appConfig.siteAlias) === -1
                ) {
                    continue
                }
                const urls = []
                if (it.url) {
                    urls.push(it.url)
                }
                const arr = it.urls || []
                for (let z = 0; z < arr.length; z++) {
                    if (arr[z] && arr[z].url) {
                        urls.push(arr[z].url)
                    }
                }
                for (let z = 0; z < urls.length; z++) {
                    const m = cpToStr(urls[z]).match(/^(https?:\/\/[^\/]+)/)
                    if (m && out.indexOf(m[1]) === -1) {
                        out.push(m[1])
                    }
                }
                if (out.length) {
                    return out
                }
            }
        }
    }
    return out
}

/** 探测某个域名是否能出列表页（真拿到内容才算赢） */
async function cpPingHost(host) {
    const r = await cpFetch(host + '/videos?hl=zh', { Accept: '*/*' }, { timeout: 7000 })
    if (!r.ok || !r.text || r.text.length < 20000) {
        return null
    }
    if (r.text.indexOf('data-i=') === -1) {
        return null
    }
    return host
}

/**
 * 选可用域名：导航站候选（若有）→ 主域名 → 备用域名，**并行竞速，先拿到有效内容的胜出**。
 * 这是本项目「域名自愈三件套」里的并行竞速部分。
 */
async function cpHeal() {
    if (cpHealedHost) {
        return cpHealedHost
    }
    if (cpHealTask) {
        return cpHealTask
    }
    cpHealTask = (async function () {
        let cands = []
        try {
            cands = await cpCandidates()
        } catch (e) {
            cands = []
        }
        for (let i = 0; i < cpHosts.length; i++) {
            if (cands.indexOf(cpHosts[i]) === -1) {
                cands.push(cpHosts[i])
            }
        }
        if (!cands.length) {
            return appConfig.webSite
        }
        const tasks = cands.map(function (h) {
            return cpPingHost(h).catch(function () {
                return null
            })
        })
        const results = await Promise.all(tasks)
        for (let i = 0; i < results.length; i++) {
            if (results[i]) {
                cpHealedHost = results[i]
                return cpHealedHost
            }
        }
        return appConfig.webSite
    })()
    const got = await cpHealTask
    if (!got) {
        cpHealTask = null
    }
    return got || appConfig.webSite
}

/**
 * 带兜底的页面请求：先打当前域，失败就换备用域重试一次。
 * （原版 py 是在 404/451/5xx 时重新自愈，这里等价实现）
 */
async function cpPage(path, referer, opts) {
    const o = opts || {}
    const tried = []
    const order = [cpSite()]
    for (let i = 0; i < cpHosts.length; i++) {
        if (order.indexOf(cpHosts[i]) === -1) {
            order.push(cpHosts[i])
        }
    }
    let last = { ok: false, code: 0, text: '', error: '未请求' }
    for (let i = 0; i < order.length; i++) {
        const u = order[i] + path
        tried.push(order[i])
        last = await cpFetch(u, { Referer: referer || order[i] + '/', Accept: 'text/html,*/*' }, o)
        if (last.ok && last.text) {
            return last
        }
    }
    // 两个域名都挂了 → 清掉自愈结果，下次重新挑
    cpHealedHost = ''
    cpHealTask = null
    last.error =
        (last.error || '请求失败') + '（已尝试 ' + tried.map(function (x) { return x.replace('https://', '') }).join(' / ') + '）'
    return last
}

//MARK: - 列表解析

/** 面板/头部/页脚先切掉，减少误匹配 */
function cpClean(html) {
    let h = cpToStr(html)
    h = h.replace(/<header[\s\S]*?<\/header>/gi, '')
    h = h.replace(/<nav[\s\S]*?<\/nav>/gi, '')
    h = h.replace(/<footer[\s\S]*?<\/footer>/gi, '')
    return h
}

/**
 * 🔴 卡片解析（**修正原版 bug**）
 *
 * py 原版是按 `<img ... data-vid="N">` 切块的，但卡片的根其实是
 *   <a data-s='/v-niche/' data-i='124556' data-u='/slug' data-q='?hl=zh' title="真标题">
 *       <div class="img"><img ... data-vid="124556" alt="真标题">
 * 于是 `a[title]` 被甩进了**上一块**，导致 vid 与 title / detail_path 整体错开一格：
 * 列表上显示的是 A 的标题，点进去打开的却是 B 的片（实测 47/47 全部错位）。
 *
 * 改成以 `<a ...data-i=...>` 为卡片边界，vid / title / path 就都自洽了。
 */
function cpCards(html) {
    const clean = cpClean(html)
    const out = []
    const re = /<a\b([^>]*\bdata-i=["'][^"']+["'][^>]*)>/gi
    let m = re.exec(clean)
    while (m) {
        const attrs = m[1]
        const s = cpAttr(attrs, 'data-s')
        const i = cpAttr(attrs, 'data-i')
        const u = cpAttr(attrs, 'data-u')
        const q = cpAttr(attrs, 'data-q')
        const title = cpHtmlDecode(cpAttr(attrs, 'title'))
        const vid = cpAttr(attrs, 'data-vid') || i
        let path = ''
        if (s && i && u) {
            // 与原版同公式：s(去掉尾斜杠) + '/' + i + u + q
            path = s.replace(/\/+$/, '') + '/' + i.replace(/^\/+|\/+$/g, '') + u + (q || '?hl=zh')
        }
        const seg = clean.slice(m.index + m[0].length, m.index + m[0].length + 900)
        let pic = ''
        const pm = seg.match(/<img[^>]+(?:data-src|data-original|src)=["']([^"']+)["']/i)
        if (pm) {
            pic = cpAbs(pm[1])
        }
        let dur = ''
        const dm = seg.match(/>\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*</)
        if (dm) {
            dur = dm[1]
        }
        if (!path && !vid) {
            m = re.exec(clean)
            continue
        }
        out.push({ vid: vid, title: title, path: path, pic: pic, dur: dur })
        m = re.exec(clean)
    }
    return out
}

//MARK: - 打包 / 解包播放入口

/** 卡片 → vod_id（用 encodeURIComponent 保证不含 @@） */
function cpPackId(c) {
    return (
        c.vid +
        '@@' +
        encodeURIComponent(c.title || '') +
        '@@' +
        encodeURIComponent(c.path || '') +
        '@@' +
        encodeURIComponent(c.pic || '')
    )
}

function cpUnpackId(rawId) {
    const parts = cpToStr(rawId).split('@@')
    function dec(s) {
        try {
            return decodeURIComponent(cpToStr(s))
        } catch (e) {
            return cpToStr(s)
        }
    }
    return {
        vid: parts[0] || '',
        title: dec(parts[1]),
        path: dec(parts[2]),
        pic: dec(parts[3]),
    }
}

/**
 * 播放标识 = `enc(直链)@@enc(详情路径)`
 *
 * 为什么把详情路径一起带上：实测直链是**静态**的（同一部片两次取完全一样），
 * 所以优先直接用直链（点播放最快）；把 path 带上是为了万一直链失效时能现场重取。
 */
function cpPackPlay(url, path) {
    return encodeURIComponent(url || '') + '@@' + encodeURIComponent(path || '')
}

function cpUnpackPlay(raw) {
    const parts = cpToStr(raw).split('@@')
    function dec(s) {
        try {
            return decodeURIComponent(cpToStr(s))
        } catch (e) {
            return cpToStr(s)
        }
    }
    return { url: dec(parts[0]), path: dec(parts[1]) }
}

function cpRemarks(dur) {
    const d = cpToStr(dur).replace(/[\r\n\t]+/g, ' ').trim()
    return d ? appConfig.brand + ' | ' + d : appConfig.brand
}

function cpListFrom(cards) {
    const out = []
    for (let i = 0; i < cards.length; i++) {
        const c = cards[i]
        if (!c.vid && !c.path) {
            continue
        }
        const vd = new VideoDetail()
        vd.vod_id = cpPackId(c)
        vd.vod_name = c.title || '视频 ' + c.vid
        vd.vod_pic = c.pic
        vd.vod_remarks = cpRemarks(c.dur)
        out.push(vd)
    }
    return out
}

//MARK: - 列表请求

async function cpListHtml(route, page, sort) {
    const q = ['hl=zh']
    if (sort) {
        q.push('s=' + encodeURIComponent(sort))
    }
    if (page > 1) {
        q.push('page=' + page)
    }
    const qs = q.join('&')
    const path = route === 'videos' ? '/videos?' + qs : '/' + route.replace(/^\/+|\/+$/g, '') + '/?' + qs
    return await cpPage(path, cpSite() + '/videos?hl=zh')
}

//MARK: - 详情 / 放映

/** 从详情页 HTML 里挑出正片直链（照搬原版优先级） */
function cpDirectFromHtml(html) {
    const h = cpToStr(html)
    function isPreview(u) {
        const low = cpToStr(u).toLowerCase()
        for (let i = 0; i < cpPreviewMarks.length; i++) {
            if (low.indexOf(cpPreviewMarks[i]) !== -1) {
                return true
            }
        }
        return false
    }
    const pats = [/<source[^>]+src=["']([^"']+)["']/gi, /<video[^>]+src=["']([^"']+)["']/gi]
    for (let p = 0; p < pats.length; p++) {
        let m = pats[p].exec(h)
        while (m) {
            if (!isPreview(m[1])) {
                return m[1].trim()
            }
            m = pats[p].exec(h)
        }
    }
    const mp4 = h.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi) || []
    for (let i = 0; i < mp4.length; i++) {
        const u = mp4[i].slice(1, -1)
        if (!isPreview(u)) {
            return u.trim()
        }
    }
    const m3u8 = h.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi) || []
    if (m3u8.length) {
        return m3u8[0].slice(1, -1).trim()
    }
    return ''
}

/** 请求详情页并解析出直链（带内存缓存，避免同一部片反复请求） */
async function cpDirect(path, force) {
    const p = cpToStr(path).trim()
    if (!p) {
        return ''
    }
    if (!force && cpDetailCache[p] && Date.now() - cpDetailCache[p].t < 10 * 60 * 1000) {
        return cpDetailCache[p].url
    }
    const r = await cpPage(p, cpSite() + '/videos?hl=zh')
    if (!r.ok || !r.text) {
        return ''
    }
    const u = cpDirectFromHtml(r.text)
    if (u) {
        cpDetailCache[p] = { url: u, t: Date.now() }
    }
    return u
}

/**
 * 🔴 播放直链预检（本项目实测驱动的关键加固）
 *
 * 实测（2026-10-04）：带 Referer 时仍有约 1/3 概率拿到 403 —— 同一地址、同一请求头
 * 连续 8 次是 [206,206,403,206,206,206,206,403]，完全是随机的（服务端多节点抖动）。
 * 而「失败后重取详情换新签名」反而更差（67% → 58%），因为换签名等于换节点、又回到随机。
 * 所以策略是：**同一地址并行探测 3 路**，任一路成功即视为可用（67% → 约 97%）。
 */
async function cpProbe(url) {
    const tasks = []
    for (let i = 0; i < cpProbeRounds; i++) {
        tasks.push(
            cpFetch(url, { Referer: cpSite() + '/' }, { timeout: cpProbeTimeout, range: 'bytes=0-1' }).then(
                function (r) {
                    return !!(r.ok && (r.code === 200 || r.code === 206))
                },
                function () {
                    return false
                }
            )
        )
    }
    const rs = await Promise.all(tasks)
    for (let i = 0; i < rs.length; i++) {
        if (rs[i]) {
            return true
        }
    }
    return false
}

/**
 * 直链是否还在有效期内。
 *
 * 实测直链形如
 *   https://www.cartoonporno.cc/jmpres/<token>/22/video01/67/1777513887/1776657341.mp4?utc=<sig>&e=1791167325
 * 这个 `e` 是 unix 秒级的过期时间（实测签发后约 24 小时）。
 * 没有 `e` 参数就当作长期有效。
 */
function cpUrlFresh(u) {
    const m = cpToStr(u).match(/[?&]e=(\d{9,})/)
    if (!m) {
        return true
    }
    const exp = parseInt(m[1], 10)
    if (isNaN(exp)) {
        return true
    }
    // 留 60 秒余量
    return exp * 1000 > Date.now() + 60000
}

/** 播放结果包装：**头里必须带 Referer**（不带的话服务端只回一个 10 秒提示流） */
function cpPlayOk(backData, url) {
    backData.data = url
    backData.headers = { 'User-Agent': appConfig.ua, Referer: cpSite() + '/' }
    return JSON.stringify(backData)
}

//MARK: - 接口实现

/**
 * 获取分类
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoClassList())
 */
async function getClassList(args) {
    var backData = new RepVideoClassList()
    try {
        // 顺带触发一次域名自愈（第一次打开时把可用域名挑出来）
        await cpHeal()
        const list = []
        const tops = cpTopClasses()
        for (let i = 0; i < tops.length; i++) {
            const vc = new VideoClass()
            vc.type_id = tops[i].id
            vc.type_name = tops[i].name
            // 每个一级分类都有「排序 + 746 个分类」筛选面板
            vc.hasSubclass = true
            list.push(vc)
        }
        backData.data = list
    } catch (error) {
        backData.error = '获取分类失败～' + cpErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 筛选列表：排序 + 746 个分类（按原版关键词聚成 6 组，全量组只在「全部视频」下给）
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoSubclassList())
 */
async function getSubclassList(args) {
    var backData = new RepVideoSubclassList()
    try {
        const sub = new VideoSubclass()
        sub.class = []

        const sortTitle = new FilterTitle()
        sortTitle.name = '排序'
        const s1 = new FilterLabel()
        s1.name = '最受欢迎'
        s1.id = ''
        const s2 = new FilterLabel()
        s2.name = '最新发布'
        s2.id = 'n'
        sortTitle.list = [s1, s2]

        const cats = cpAllCats()
        const buckets = { sec_3d: [], sec_anime: [], sec_char: [], sec_physique: [], sec_roleplay: [], sec_scenes: [] }
        for (let i = 0; i < cats.length; i++) {
            const lowR = cats[i].route.toLowerCase()
            const lowN = cats[i].name.toLowerCase()
            let put = 'sec_scenes'
            const order = ['sec_3d', 'sec_char', 'sec_anime', 'sec_physique', 'sec_roleplay']
            for (let k = 0; k < order.length; k++) {
                const kws = cpKw[order[k]]
                let hit = false
                for (let z = 0; z < kws.length; z++) {
                    if (lowR.indexOf(kws[z]) !== -1 || lowN.indexOf(kws[z]) !== -1) {
                        hit = true
                        break
                    }
                }
                if (hit) {
                    put = order[k]
                    break
                }
            }
            buckets[put].push(cats[i])
        }

        const groupNames = {
            sec_3d: '3D及CG分类',
            sec_anime: '动漫二次元分类',
            sec_char: '专属同人角色',
            sec_physique: '体貌特征分类',
            sec_roleplay: '职业角色分类',
            sec_scenes: '情境与玩法分类',
        }
        const filterTitles = []
        const order2 = ['sec_3d', 'sec_anime', 'sec_char', 'sec_physique', 'sec_roleplay', 'sec_scenes']
        for (let i = 0; i < order2.length; i++) {
            const key = order2[i]
            const ft = new FilterTitle()
            ft.name = groupNames[key]
            const all = new FilterLabel()
            all.name = '全部'
            all.id = ''
            const arr = [all]
            for (let z = 0; z < buckets[key].length; z++) {
                const fl = new FilterLabel()
                fl.name = buckets[key][z].name
                fl.id = buckets[key][z].route
                arr.push(fl)
            }
            ft.list = arr
            filterTitles.push(ft)
        }
        sub.filter = [sortTitle].concat(filterTitles)
        backData.data = sub
    } catch (error) {
        backData.error = '获取筛选项失败～' + cpErrText(error)
    }
    return JSON.stringify(backData)
}

async function cpList(backData, tid, page, sort, cat) {
    const slug = cpToStr(tid).trim() || 'videos'
    let route = cat ? cpToStr(cat).replace(/^\/+|\/+$/g, '') : cpSecRoute[slug] || slug
    if (!cat && slug === 'videos') {
        route = 'videos'
    }
    const r = await cpListHtml(route, page, sort)
    if (!r.ok || !r.text) {
        backData.error = '列表获取失败：' + (r.error || '接口没有返回数据')
        return
    }
    const cards = cpCards(r.text)
    backData.data = cpListFrom(cards)
    if (!cards.length) {
        backData.error = '这个分类的第 ' + page + ' 页没有内容了'
    }
}

/**
 * 分类视频列表（无筛选）
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoList())
 */
async function getVideoList(args) {
    var backData = new RepVideoList()
    try {
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        await cpList(backData, args && args.url, page, '', '')
    } catch (error) {
        backData.error = '获取列表失败～' + cpErrText(error)
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
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        let sort = ''
        let cat = ''
        const f = (args && args.filter) || []
        // 顺序与 getSubclassList 返回的 FilterTitle 一致：先排序、再分类
        if (f.length > 0 && f[0]) {
            sort = cpToStr(f[0].id)
        }
        if (f.length > 1 && f[1]) {
            cat = cpToStr(f[1].id)
        }
        const tid = (args && (args.mainClassId || args.url)) || 'videos'
        await cpList(backData, tid, page, sort, cat)
    } catch (error) {
        backData.error = '获取列表失败～' + cpErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 详情：直接把正片直链放进入口（实测直链是静态的），同时把详情路径带上备用
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoDetail())
 */
async function getVideoDetail(args) {
    var backData = new RepVideoDetail()
    try {
        const pack = cpUnpackId(args && args.url)
        const direct = await cpDirect(pack.path)

        const vd = new VideoDetail()
        vd.vod_id = cpToStr(args && args.url)
        vd.vod_name = pack.title || '视频 ' + pack.vid
        vd.vod_pic = pack.pic
        vd.vod_actor = '🦋 ' + appConfig.tg.replace('https://t.me/', 'TG群: @')
        vd.vod_director = '🦋 ' + appConfig.brand
        vd.vod_remarks = cpRemarks('HD完整正片')
        vd.vod_content =
            '【🔥 官方交流群: ' +
            appConfig.tg +
            '】\n【当前优选节点: ' +
            cpSite() +
            '】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n片名: ' +
            (pack.title || '') +
            '\n编号: ' +
            pack.vid +
            '\n线路: 蝴蝶专线 完整长片正片'
        vd.vod_play_from = '🦋 蝴蝶专线'
        vd.vod_play_url = '超清完整正片$' + cpPackPlay(direct, pack.path)
        if (!direct) {
            backData.error = '这部片在详情页里没有找到正片直链（可能已下架）'
        }
        backData.data = vd
    } catch (error) {
        backData.error = '获取详情失败～' + cpErrText(error)
    }
    return JSON.stringify(backData)
}

/**
 * 播放：优先用详情里带的直链做并行预检；全挂则重取详情换一把再试；仍失败就原样交出去
 * @param {UZArgs} args
 * @returns {Promise<string>} JSON.stringify(new RepVideoPlayUrl())
 */
async function getVideoPlayUrl(args) {
    var backData = new RepVideoPlayUrl()
    try {
        const got = cpUnpackPlay(args && args.url)
        let url = got.url
        const path = got.path

        // 直链自带 e=<unix秒> 有效期（实测约 24 小时），过期了就别用了，直接重取
        if (url && !cpUrlFresh(url)) {
            url = ''
        }
        if (!url && path) {
            url = await cpDirect(path, true)
        }
        if (!url) {
            backData.error = '没有可用的播放地址（详情页没有解析出直链）'
            return JSON.stringify(backData)
        }

        if (await cpProbe(url)) {
            return cpPlayOk(backData, url)
        }
        // 预检全挂 → 重取详情换一把新签名再试一轮
        if (path) {
            const fresh = await cpDirect(path, true)
            if (fresh && fresh !== url) {
                if (await cpProbe(fresh)) {
                    return cpPlayOk(backData, fresh)
                }
                url = fresh
            }
        }
        // 还是不行：把地址原样交出去，让播放器自己重试（不会比修前更差）
        return cpPlayOk(backData, url)
    } catch (error) {
        backData.error = '获取播放地址失败～' + cpErrText(error)
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
        const kw = cpToStr(args && args.searchWord).trim()
        if (!kw) {
            return JSON.stringify(backData)
        }
        let page = args && args.page ? parseInt(args.page, 10) : 1
        if (isNaN(page) || page < 1) {
            page = 1
        }
        let path = '/search?q=' + encodeURIComponent(kw) + '&hl=zh'
        if (page > 1) {
            path += '&page=' + page
        }
        const r = await cpPage(path, cpSite() + '/videos?hl=zh')
        if (!r.ok || !r.text) {
            backData.error = '搜索失败：' + (r.error || '没有返回数据')
            return JSON.stringify(backData)
        }
        const cards = cpCards(r.text)
        backData.data = cpListFrom(cards)
        if (!cards.length) {
            backData.error = '没有搜到「' + kw + '」相关内容'
        }
    } catch (error) {
        backData.error = '搜索失败～' + cpErrText(error)
    }
    return JSON.stringify(backData)
}
