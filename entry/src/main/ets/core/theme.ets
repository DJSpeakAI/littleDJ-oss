// @提供 THEME 尺寸与排版 token（色 token 走 resources color.json 的 $r 引用，码内禁裸 hex） @依赖 -
// M0.1 task361：从 ui/index.html CSS 变量提取（P2-12 默认深色对齐 PWA 暗色）
export class THEME {
  static readonly FONT_BODY: number = 15;
  static readonly FONT_SUB: number = 12.5;
  static readonly FONT_TITLE: number = 16;
  static readonly FONT_MSG: number = 15.5;
  static readonly RADIUS_CARD: number = 12;
  static readonly RADIUS_BUBBLE: number = 12;
  static readonly RADIUS_INPUT: number = 10;
  static readonly PAD_PAGE: number = 12;
  static readonly PAD_CARD: number = 10;
  static readonly GAP_MSG: number = 14;
  static readonly AVATAR: number = 30;
  static readonly SIDEBAR_W: number = 300;
  static readonly RIGHT_W: number = 240;
  static readonly INPUT_MAX_H: number = 160;
}
