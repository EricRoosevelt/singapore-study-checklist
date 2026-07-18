import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const requestedPath = process.argv[2];
const defaultPath = fs.existsSync("index.html")
  ? "index.html"
  : "新加坡留学物资清单_手机版.html";
const htmlPath = path.resolve(requestedPath || defaultPath);
const html = fs.readFileSync(htmlPath, "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(scriptMatch, "找不到内嵌脚本");
new Function(scriptMatch[1]);

const script = scriptMatch[1];
const runtimeStart = script.indexOf("let storageWritable");
const helpersStart = script.indexOf("function emptyState()");
const helpersEnd = script.indexOf("function isPackEnabled");
assert(runtimeStart > 0 && helpersStart > runtimeStart && helpersEnd > helpersStart, "找不到校验所需代码边界");

const context = {};
vm.createContext(context);
vm.runInContext(
  script.slice(0, runtimeStart) +
    script.slice(helpersStart, helpersEnd) +
    "\n;globalThis.__audit = { ITEMS, PACKS, OPTIONAL_PACK_IDS, CATEGORIES, SOURCE_LINKS, CONTENT_VERSION, VERIFIED_AT, emptyState, normalizeState, migrateV2State, migrateLegacyState };",
  context
);

const {
  ITEMS,
  PACKS,
  OPTIONAL_PACK_IDS,
  CATEGORIES,
  SOURCE_LINKS,
  CONTENT_VERSION,
  VERIFIED_AT,
  emptyState,
  normalizeState,
  migrateV2State,
  migrateLegacyState
} = context.__audit;
const ids = ITEMS.map(item => item.id);
const markupBeforeScript = html.slice(0, html.indexOf("<script>"));
const expectedCategories = [
  ["证件与手续", 17, "core"],
  ["随身与出行", 15, "core"],
  ["数码与充电", 8, "core"],
  ["基础洗漱", 9, "core"],
  ["基础衣物", 9, "core"],
  ["入境与行李提醒", 5, "core"],
  ["住宿与清洁", 34, "dorm"],
  ["学习文具", 14, "study"],
  ["厨房与做饭", 10, "cooking"],
  ["美妆与个人护理", 48, "beauty"],
  ["扩展衣物与鞋包", 22, "clothing"],
  ["数码扩展", 16, "tech"],
  ["药品与健康", 11, "health"],
  ["旅行用品", 13, "travel"]
];
const expectedPackCounts = {
  core: 63,
  dorm: 34,
  study: 14,
  cooking: 10,
  beauty: 48,
  clothing: 22,
  tech: 16,
  health: 11,
  travel: 13
};
const requiredFields = ["id", "item", "qty", "note", "packId", "categoryId", "categoryName"];
const unsafePattern = /罗红霉素|原件过塑|印花税缴纳记录|Part 2|OSE/;

assert(ITEMS.length === 231, "发布条目数异常：" + ITEMS.length);
assert(new Set(ids).size === ids.length, "条目 id 不唯一");
assert(ids.every(id => typeof id === "string" && id.length > 0), "存在非字符串或空 id");
assert(ITEMS.every(item => requiredFields.every(field => Object.hasOwn(item, field))), "存在缺失分类或显示字段的条目");
assert(ITEMS.every(item => Object.hasOwn(PACKS, item.packId)), "存在未知可选包");
assert(ITEMS.every(item => !item.sourceKey || Object.hasOwn(SOURCE_LINKS, item.sourceKey)), "存在未知官方来源");
assert(!ITEMS.some(item => unsafePattern.test(item.item + " " + item.note)), "发布条目仍包含已移除的高风险内容");
assert(ITEMS.some(item => item.id === "task_sg_arrival_card"), "缺少 SG Arrival Card");
assert(ITEMS.some(item => item.item.startsWith("eForm 16")), "缺少 eForm 16");
assert(!ITEMS.some(item => item.id === "item_177" || item.id === "item_183"), "合并后旧条目仍存在");
assert(ITEMS.some(item => item.id === "item_035_03" && item.item === "洗漱杯"), "洗漱杯合并异常");
assert(ITEMS.some(item => item.id === "item_140" && item.item === "睡衣 / 家居服"), "睡衣 / 家居服合并异常");
assert(ITEMS.some(item => item.id === "item_sun_protection_clothing" && item.item === "防晒服" && item.categoryId === "base-clothing"), "基础衣物缺少防晒服");
assert(ITEMS.some(item => item.id === "item_141" && item.item === "运动鞋" && item.categoryId === "base-clothing"), "运动鞋分类或名称异常");
assert(["item_006_01", "item_006_02"].every(id => ITEMS.some(item => item.id === id && item.qty === "1+2")), "毕业证或学位证数量异常");
assert(ITEMS.some(item => item.id === "item_011" && item.note.includes("光面") && item.note.includes("绒面")), "证件照备注异常");

const actualCategories = CATEGORIES.map(category => [
  category.name,
  ITEMS.filter(item => item.categoryId === category.id).length,
  category.packId
]);
assert(JSON.stringify(actualCategories) === JSON.stringify(expectedCategories), "分类顺序或数量异常：" + JSON.stringify(actualCategories));

const packCounts = Object.fromEntries(
  Object.keys(PACKS).map(packId => [packId, ITEMS.filter(item => item.packId === packId).length])
);
assert(JSON.stringify(packCounts) === JSON.stringify(expectedPackCounts), "可选包数量异常：" + JSON.stringify(packCounts));
assert(OPTIONAL_PACK_IDS.every(packId => {
  const categories = CATEGORIES.filter(category => category.packId === packId);
  return categories.length === 1 && categories[0].name === PACKS[packId].name;
}), "可选包名称与分类名称未一一对应");

const cleanState = normalizeState(emptyState());
assert(cleanState.completedIds.length === 0, "干净状态存在默认勾选");
assert(cleanState.customItems.length === 0, "干净状态存在默认自定义条目");
assert(cleanState.deletedIds.length === 0, "干净状态存在默认删除");
assert(cleanState.enabledPackIds.length === 0, "干净状态默认启用了可选包");
assert(!/\schecked(?:\s|>)/i.test(markupBeforeScript), "HTML 中存在静态默认勾选");

const v2Migrated = migrateV2State({
  completedIds: ["item_177", "item_183"],
  deletedIds: ["item_035_03", "item_177", "item_140"],
  itemEdits: {
    item_177: { item: "旧版洗漱杯编辑", qty: "1个", note: "保留" },
    item_140: { item: "目标编辑优先", qty: "", note: "目标" },
    item_183: { item: "不应覆盖目标", qty: "", note: "来源" }
  },
  enabledPackIds: ["dorm"]
});
assert(v2Migrated.completedIds.includes("item_035_03") && v2Migrated.completedIds.includes("item_140"), "v2 合并项勾选迁移失败");
assert(v2Migrated.deletedIds.includes("item_035_03") && !v2Migrated.deletedIds.includes("item_140"), "v2 合并项删除迁移失败");
assert(v2Migrated.itemEdits.item_035_03?.item === "旧版洗漱杯编辑", "v2 来源编辑迁移失败");
assert(v2Migrated.itemEdits.item_140?.item === "目标编辑优先", "v2 目标编辑优先级异常");
assert(["dorm", "study", "travel"].every(id => v2Migrated.enabledPackIds.includes(id)), "v2 住宿包范围迁移失败");

const v1Migrated = migrateV2State(migrateLegacyState({
  completedIds: [177, 183],
  deletedIds: [35, 177, 140, 183],
  itemEdits: { 177: { item: "v1 洗漱杯", qty: "", note: "迁移" } }
}));
assert(v1Migrated.completedIds.includes("item_035_03") && v1Migrated.completedIds.includes("item_140"), "v1 合并项勾选迁移失败");
assert(v1Migrated.deletedIds.includes("item_035_03") && v1Migrated.deletedIds.includes("item_140"), "v1 合并项删除迁移失败");
assert(v1Migrated.itemEdits.item_035_03?.item === "v1 洗漱杯", "v1 编辑迁移失败");

assert(html.includes('name="description"'), "缺少页面描述");
assert(html.includes('property="og:title"'), "缺少分享标题");
assert(html.includes("sgPackingChecklist_v3"), "缺少 v3 本地存储");
assert(html.includes("sgPackingChecklist_v2"), "缺少 v2 迁移入口");
assert(html.includes("sgPackingChecklist_v1"), "缺少 v1 迁移入口");
assert(!html.includes("data-collapse-kind"), "仍包含旧二级折叠逻辑");
assert(!html.includes("KIND_LABELS") && !html.includes("BAGGAGE_LABELS") && !html.includes("sourceTag("), "仍渲染多余条目标签");
assert((markupBeforeScript.match(/data-filter=/g) || []).length === 3, "状态筛选按钮数量异常");

console.log("校验通过：" + path.basename(htmlPath));
console.log("内容版本：" + CONTENT_VERSION + "，核验日期：" + VERIFIED_AT);
console.log("总条目：" + ITEMS.length + "，分类分布：" + JSON.stringify(Object.fromEntries(actualCategories.map(([name, count]) => [name, count]))));
