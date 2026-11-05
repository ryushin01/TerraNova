/**
 * Icons a crop can have, and the names that suggest each one. The web app maps each key to
 * artwork. Korean and English names are matched; anything unknown gets a sprout.
 */
export const CROP_ICON_KEYWORDS = {
  sprout: [],
  flower: ["도라지", "꽃", "국화", "튤립", "백합", "카네이션", "라벤더", "flower", "tulip", "lily", "lavender"],
  rose: ["장미", "rose"],
  sunflower: ["해바라기", "sunflower"],
  wheat: ["벼", "쌀", "밀", "보리", "귀리", "수수", "흑미", "찹쌀", "호밀", "rice", "wheat", "barley", "oat", "rye"],
  corn: ["옥수수", "corn", "maize"],
  leaf: ["상추", "시금치", "깻잎", "들깨", "쑥갓", "아욱", "미나리", "근대", "치커리", "lettuce", "spinach", "chard"],
  herb: ["바질", "허브", "로즈마리", "민트", "쑥", "고수", "herb", "basil", "mint", "rosemary", "cilantro"],
  cabbage: ["배추", "양배추", "케일", "청경채", "cabbage", "kale", "bok choy"],
  broccoli: ["브로콜리", "콜리플라워", "broccoli", "cauliflower"],
  leek: ["파", "대파", "쪽파", "부추", "leek", "scallion", "chive"],
  garlic: ["마늘", "양파", "생강", "garlic", "onion", "ginger"],
  carrot: ["당근", "carrot"],
  beet: ["비트", "무", "순무", "열무", "beet", "radish", "turnip"],
  roots: ["인삼", "산삼", "더덕", "우엉", "연근", "ginseng", "burdock"],
  potato: ["감자", "고구마", "토란", "야콘", "마", "potato", "yam", "taro"],
  tomato: ["토마토", "tomato"],
  chili: ["고추", "청양", "chili", "chilli", "hot pepper"],
  bellPepper: ["피망", "파프리카", "paprika", "bell pepper"],
  eggplant: ["가지", "eggplant", "aubergine"],
  pumpkin: ["호박", "단호박", "pumpkin", "squash", "zucchini"],
  watermelon: ["수박", "참외", "멜론", "watermelon", "melon"],
  strawberry: ["딸기", "strawberry"],
  berry: ["복분자", "라즈베리", "블루베리", "오디", "베리", "berry"],
  apple: ["사과", "apple"],
  pear: ["배", "pear"],
  grape: ["포도", "샤인머스캣", "머루", "grape"],
  citrus: ["귤", "감귤", "오렌지", "한라봉", "천혜향", "유자", "orange", "tangerine", "citrus"],
  lemon: ["레몬", "라임", "lemon", "lime"],
  peach: ["복숭아", "자두", "살구", "매실", "감", "peach", "plum", "apricot", "persimmon"],
  cherry: ["체리", "앵두", "cherry"],
  banana: ["바나나", "banana"],
  pineapple: ["파인애플", "pineapple"],
  kiwi: ["키위", "다래", "kiwi"],
  avocado: ["아보카도", "avocado"],
  olive: ["올리브", "olive"],
  bean: ["콩", "대두", "팥", "녹두", "강낭콩", "bean", "soy"],
  peas: ["완두", "pea"],
  peanut: ["땅콩", "peanut"],
  nut: ["호두", "잣", "밤", "아몬드", "walnut", "almond", "chestnut", "nut"],
  acorn: ["도토리", "acorn"],
  mushroom: ["버섯", "표고", "느타리", "mushroom"],
  tea: ["녹차", "찻잎", "tea"],
  coffee: ["커피", "coffee"],
  grass: ["잔디", "목초", "grass", "hay"],
  tree: ["나무", "과수", "묘목", "tree"],
} as const satisfies Record<string, readonly string[]>;

export type CropIconKey = keyof typeof CROP_ICON_KEYWORDS;

export const CROP_ICON_KEYS = Object.keys(CROP_ICON_KEYWORDS) as CropIconKey[];

export function isCropIconKey(value: unknown): value is CropIconKey {
  return typeof value === "string" && Object.hasOwn(CROP_ICON_KEYWORDS, value);
}

/** The longest matching keyword wins, so 양배추 is a cabbage and not a pear (배). */
export function suggestCropIcon(name: string): CropIconKey {
  const normalized = name.toLowerCase().replace(/\s+/g, "");
  let best: CropIconKey = "sprout";
  let bestLength = 0;

  for (const key of CROP_ICON_KEYS) {
    for (const keyword of CROP_ICON_KEYWORDS[key] as readonly string[]) {
      const word = keyword.replace(/\s+/g, "");
      // One-letter Korean words only count at the end: 대파 is a leek, 파프리카 is not.
      const matches = word.length === 1 ? normalized.endsWith(word) : normalized.includes(word);
      if (matches && word.length > bestLength) {
        best = key;
        bestLength = word.length;
      }
    }
  }
  return best;
}
