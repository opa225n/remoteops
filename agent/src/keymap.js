// Correspondance entre KeyboardEvent.code (navigateur/Chromium) et
// l'énumération Key de nut-js. Couvre les touches d'usage courant ;
// une touche absente de cette table est simplement ignorée côté agent
// (aucune frappe fantôme n'est injectée).
import { Key } from "@nut-tree-fork/nut-js";

export const CODE_TO_NUT_KEY = {
  // Lettres
  KeyA: Key.A, KeyB: Key.B, KeyC: Key.C, KeyD: Key.D, KeyE: Key.E,
  KeyF: Key.F, KeyG: Key.G, KeyH: Key.H, KeyI: Key.I, KeyJ: Key.J,
  KeyK: Key.K, KeyL: Key.L, KeyM: Key.M, KeyN: Key.N, KeyO: Key.O,
  KeyP: Key.P, KeyQ: Key.Q, KeyR: Key.R, KeyS: Key.S, KeyT: Key.T,
  KeyU: Key.U, KeyV: Key.V, KeyW: Key.W, KeyX: Key.X, KeyY: Key.Y,
  KeyZ: Key.Z,
  // Chiffres (rangée du haut)
  Digit0: Key.Num0, Digit1: Key.Num1, Digit2: Key.Num2, Digit3: Key.Num3,
  Digit4: Key.Num4, Digit5: Key.Num5, Digit6: Key.Num6, Digit7: Key.Num7,
  Digit8: Key.Num8, Digit9: Key.Num9,
  // Pavé numérique
  Numpad0: Key.NumPad0, Numpad1: Key.NumPad1, Numpad2: Key.NumPad2,
  Numpad3: Key.NumPad3, Numpad4: Key.NumPad4, Numpad5: Key.NumPad5,
  Numpad6: Key.NumPad6, Numpad7: Key.NumPad7, Numpad8: Key.NumPad8,
  Numpad9: Key.NumPad9, NumpadAdd: Key.Add, NumpadSubtract: Key.Subtract,
  NumpadMultiply: Key.Multiply, NumpadDivide: Key.Divide,
  NumpadEnter: Key.Enter, NumpadDecimal: Key.Decimal,
  // Fonction
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  // Navigation / édition
  Enter: Key.Enter, Escape: Key.Escape, Backspace: Key.Backspace, Tab: Key.Tab,
  Space: Key.Space, Delete: Key.Delete, Insert: Key.Insert,
  Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
  // Modificateurs
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper,
  CapsLock: Key.CapsLock,
  // Ponctuation courante (disposition US QWERTY ; une disposition
  // différente côté poste distant décalera ces symboles — limite connue,
  // voir README)
  Minus: Key.Minus, Equal: Key.Equal,
  BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket,
  Semicolon: Key.Semicolon, Quote: Key.Quote, Backquote: Key.Grave,
  Comma: Key.Comma, Period: Key.Period, Slash: Key.Slash, Backslash: Key.Backslash,
};
