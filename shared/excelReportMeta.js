export const INPUT_SHEETS = {
  missevan: "Missevan",
  manbo: "Manbo",
};

export const OUTPUT_SHEETS = {
  missevan: {
    paid: "猫耳-付费",
    member: "猫耳-会员",
    free: "猫耳-免费",
  },
  manbo: {
    paid: "漫播-付费",
    member: "漫播-会员",
    free: "漫播-免费",
  },
};

export const SHEET_THEMES = {
  missevan: {
    paid: { tabColor: "C65A38", headerFill: "FFF0EA", accentFill: "FFF7F3" },
    member: { tabColor: "2F5D7C", headerFill: "EAF4FB", accentFill: "F4FAFD" },
    free: { tabColor: "3B7A57", headerFill: "EAF7EF", accentFill: "F5FBF7" },
  },
  manbo: {
    paid: { tabColor: "A2463C", headerFill: "FDEEEB", accentFill: "FFF7F4" },
    member: { tabColor: "566C9C", headerFill: "EEF2FC", accentFill: "F8F9FE" },
    free: { tabColor: "4C8B7A", headerFill: "EDF8F5", accentFill: "F7FCFA" },
  },
};

export const HEADERS = {
  missevan: {
    paid: ["排行", "标题", "总播放量（万）", "全季ID", "第一季ID", "追剧人次", "打赏（万钻石）", "打赏人次", "最低收益（万元）", "总价（钻石）"],
    member: ["排行", "标题", "总播放量（万）", "全季ID", "第一季ID", "追剧人次", "打赏（万钻石）", "打赏人次", "总价（钻石）"],
    free: ["排行", "标题", "总播放量（万）", "全季ID（正片）", "第一季ID（正片）", "追剧人次"],
  },
  manbo: {
    paid: ["排行", "标题", "总播放量（万）", "全季ID", "第一季ID", "收藏人次", "投喂（万红豆）", "最低收益（万元）", "总价（红豆）"],
    member: ["排行", "标题", "总播放量（万）", "全季ID", "第一季ID", "收藏人次", "投喂（万红豆）"],
    free: ["排行", "标题", "总播放量（万）", "全季ID（正片）", "第一季ID（正片）", "收藏数"],
  },
};

export function createEmptyGroupedRows() {
  return {
    missevan: { paid: [], member: [], free: [] },
    manbo: { paid: [], member: [], free: [] },
  };
}

export function getOutputSheetName(platform, category) {
  return OUTPUT_SHEETS[platform][category];
}
