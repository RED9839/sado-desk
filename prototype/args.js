/* 실행 인자 읽기 — 세 파일(main·updater·test-hooks)이 같은 두 줄을 각자 갖고 있었다.
 *   const { argHas, argVal } = require("./args.js");
 *   argHas("--selftest")            → 있는지
 *   argVal("--quit-in", 30)         → 뒤에 붙은 값(없으면 기본값)
 */
const argHas = (f) => process.argv.includes(f);
const argVal = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
module.exports = { argHas, argVal };
