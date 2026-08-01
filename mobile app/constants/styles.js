Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalStyles = void 0;
var _reactNative = require("react-native");
var _colors = require("./colors");

var GlobalStyles = (exports.GlobalStyles = _reactNative.StyleSheet.create({
  // ── Containers ─────────────────────────────────────────────
  screen: {
    flex: 1,
    backgroundColor: _colors.Colors.bg,
  },
  safeArea: {
    flex: 1,
    backgroundColor: _colors.Colors.bg,
  },
  card: {
    backgroundColor: _colors.Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: _colors.Colors.border,
    padding: 20,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Typography ────────────────────────────────────────────
  h1: {
    fontSize: 28,
    fontWeight: "700",
    color: _colors.Colors.text,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 22,
    fontWeight: "700",
    color: _colors.Colors.text,
  },
  h3: {
    fontSize: 18,
    fontWeight: "600",
    color: _colors.Colors.text,
  },
  body: {
    fontSize: 15,
    color: _colors.Colors.text,
    lineHeight: 22,
  },
  caption: {
    fontSize: 13,
    color: _colors.Colors.textMuted,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: _colors.Colors.textMuted,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // ── Inputs ───────────────────────────────────────────────
  inputContainer: {
    marginBottom: 16,
  },
  input: {
    backgroundColor: _colors.Colors.input,
    borderWidth: 1,
    borderColor: _colors.Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: _reactNative.Platform.OS === "ios" ? 14 : 11,
    fontSize: 15,
    color: _colors.Colors.text,
  },
  inputFocused: {
    borderColor: _colors.Colors.primary,
  },

  // ── Buttons ──────────────────────────────────────────────
  btnPrimary: {
    backgroundColor: _colors.Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  btnDanger: {
    backgroundColor: _colors.Colors.danger,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnDangerText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: _colors.Colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnOutlineText: {
    color: _colors.Colors.textMuted,
    fontSize: 16,
  },

  // ── Divider ──────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: _colors.Colors.border,
    marginVertical: 16,
  },

  // ── Badge ────────────────────────────────────────────────
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
}));
