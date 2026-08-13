# 原版资源与业务脚本清单

- ASAR 文件总数：3328
- 非第三方应用文件：55
- 视觉资源：4
- 业务模块脚本：35
- 核心辅助脚本：6
- HTML 直接加载脚本：40

## 文件类型统计

| 扩展名 | 数量 |
| --- | ---: |
| `.js` | 2011 |
| `.map` | 625 |
| `.json` | 232 |
| `[none]` | 136 |
| `.ts` | 127 |
| `.mjs` | 25 |
| `.h` | 25 |
| `.md` | 22 |
| `.txt` | 22 |
| `.cpp` | 18 |
| `.cmake` | 18 |
| `.cjs` | 10 |
| `.gbnf` | 8 |
| `.html` | 6 |
| `.so` | 5 |
| `.png` | 4 |
| `.dylib` | 4 |
| `.gypi` | 3 |
| `.jpg` | 2 |
| `.node` | 2 |
| `.cts` | 2 |
| `.bnf` | 2 |
| `.njs` | 2 |
| `.mts` | 2 |
| `.tsbuildinfo` | 2 |
| `.def` | 2 |
| `.gyp` | 2 |
| `.cs` | 1 |
| `.diff` | 1 |
| `.c` | 1 |
| `.gif` | 1 |
| `.apache2` | 1 |
| `.bsd` | 1 |
| `.mit` | 1 |
| `.markdown` | 1 |
| `.css` | 1 |

## 非第三方应用文件

| 路径 | 大小 | SHA-256 |
| --- | ---: | --- |
| `builder-config.json` | 552 | `41b24534886550875afa6e2cc162cf577d15f8149c62d6d9cf61e12a06dd6694` |
| `index.html` | 243928 | `08cf2c620eb4238eeedd3d4b77136895bd71a6e5644fe9a3dccfcc0128225b4e` |
| `js/core/ai-server.js` | 15256 | `d02cf3b4bcbf12fafd40bf3d76dfa934e6fec40275a68e4cc0018d8383d1d106` |
| `js/core/excel-cell-normalizer.js` | 7641 | `0e2118e6d5261a46f11704bf4bd3b62062b50106325dd65a3757a810e0c785a6` |
| `js/core/qrcode.min.js` | 20129 | `1459891f021190e3ad05a109ebb6de4a1a902eaa3e53de7512be2870e87c5635` |
| `js/core/utils.js` | 65053 | `1e22014226ded92fb420103c44a2fa30d80079325e76c0f921702dc73782d140` |
| `js/core/xlsx-raw-cell-reader.js` | 10037 | `15283816704036c0104f6824433c0b974b941df33036bba64798dda47003c1a4` |
| `js/core/xlsx.full.min.js` | 881727 | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` |
| `js/echarts.min.js` | 5953801 | `0e50840d517df2bde326f475174f9cf4ddb193d5323564e8684df973019a22e5` |
| `js/html2canvas.min.js` | 198689 | `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb` |
| `js/modules/ai/ai_audit_logger.js` | 5939 | `4795286e5899eff779f309512873c68ef0284be108fd3138305081e955289b4f` |
| `js/modules/ai/ai_config.js` | 4807 | `42e5fc331deb5ff6ad358fe21ffe5f322d90154db094dbabc11c4f7ee8907047` |
| `js/modules/ai/ai_confirmation_guard.js` | 11156 | `a76a290f2adcf0564569f325528ba24fabfc5e757bc34d64f3ba50f5b614b638` |
| `js/modules/ai/ai_conversation_manager.js` | 20951 | `7ae5f95c2dccd06665e1db1e229602a497e0e61995db34c4ccbd0e13d3ab584d` |
| `js/modules/ai/ai_dictionary_registry.js` | 9310 | `0583a1f7226086fa021fb9b75268b39ed0ca9451d4e167c6c74ba7f70042ddb9` |
| `js/modules/ai/ai_entity_extractor.js` | 11031 | `f517ae2a08cd6e81239e915d59897a43014a5f3f0b6b213a7253dedee6bd588e` |
| `js/modules/ai/ai_llm_client.js` | 13173 | `4b79c2d13bb82f9a71b8bbd75f0205b7162d68e46baed7da60ce0e514787b8b9` |
| `js/modules/ai/ai_masking_utils.js` | 5462 | `075d9999e64d5bd331c20ad8495ec4802e76938bb4b035b9fd4689e20aa7df34` |
| `js/modules/ai/ai_mode_router.js` | 3695 | `d599840643e460cfa6c9cf848b524c03c7745baa70732eb6484403d665a73c0e` |
| `js/modules/ai/ai_orchestrator.js` | 114585 | `4f5b7d6cf6c6b447162f7ce2fbf5d19f91440fcd66ebea6f63f9327531ab72ae` |
| `js/modules/ai/ai_prompt_context.js` | 37225 | `578fb92a121c03d4aa3a361c7ceca7ec81e539b4fcbf3e5696bc03b004cd7e4a` |
| `js/modules/ai/ai_schema_validator.js` | 6233 | `ec189426a7c2c8eaf0101915252ccc4d9e6db83d118d637154a08f82a5774099` |
| `js/modules/ai/ai_skill_registry.js` | 12037 | `c06cbc924f4baabc2b28c726599b911070df37e474ec47fdd8148eff626d7836` |
| `js/modules/ai/ai_text_normalizer.js` | 4687 | `e99e849e23aa88fd4f5167b82215b1ba3a44d7a6d5281c8f91e5cac9add47ea0` |
| `js/modules/ai/ai_ui_adapter.js` | 61267 | `c340ee399d39a043373183e71e524b43f90d0d61b8147b27e03d253588759abf` |
| `js/modules/ai/ai_workflow.js` | 13526 | `b5561a1d5deedd840f9c5cde6d85c6961d5eef5fc105ca86b85e57b6808fefb4` |
| `js/modules/ai/dictionary/person_dictionary.js` | 4978 | `41b591c93e05a77d3cb79fd30ed26b56b5a646c0fa77f1b246503c5c2c7b49cf` |
| `js/modules/ai/dictionary/record_dictionary.js` | 5549 | `5091ba138a433bc25afc3c76f11684ce9d67e12ba1852c1e9a5269676619f667` |
| `js/modules/ai/schemas/person_skill_schemas.js` | 16948 | `80c681be86dd52f16a70d4cf4c07ad42390fe6f05ed6cdb8105eb3665e600680` |
| `js/modules/ai/schemas/record_skill_schemas.js` | 7808 | `26655a0276899e913c89ab25c7b7242a41fd2b2316bfa28c54298f64f285b644` |
| `js/modules/ai/skills_duty.js` | 60035 | `a02764ed6889e4985939c8a1a312f449200b3539c8b481a1237015ff107f13a6` |
| `js/modules/ai/skills_household.js` | 43080 | `bbdbb5361134362a47aff5ce09b984fda9d4bc9f94d35927445f5017134b106b` |
| `js/modules/ai/skills_land.js` | 48196 | `37e53a0d0b8c44b26a6d53ac06833d846e9c5693adbd8738889f5f580c490276` |
| `js/modules/ai/skills_party.js` | 79961 | `afe4776fdb04f842521cb69a741682fc0cc1226bff225e31694356788342e2dc` |
| `js/modules/ai/skills_person.js` | 62324 | `abda5537a5f01bbd8e7d95f303c7239daa24a83e006faba69db35fcb54f85687` |
| `js/modules/ai/skills_record.js` | 47188 | `bb9e106247dbc4b12c2ef8e3f56258da2d6fc26cad080e4ed6e44fcac9009f91` |
| `js/modules/ai/skills_stats.js` | 21539 | `ce7980bf61bcd14b1903aad3222327d5b6f52feac1b89b972c608459d9543872` |
| `js/modules/ai/skills_ui.js` | 86798 | `27762a8d572da47f8a07148f4e03fe3b1f2f746f8ef44e67e367ddab474be162` |
| `js/modules/appeal_visit_skill.js` | 14724 | `8fb7209dfbeb2063361b778786943e53e6995d206e3093868657bed6a55e5ef5` |
| `js/modules/certificate.js` | 137425 | `edd8f6c74e6b659af5b01acf3295bdff568799e3495de88871a1b7a20f2d416b` |
| `js/modules/duty-flexible.js` | 146506 | `90a4fb3649d4303ebb43568abf60ff5885fb6aec55497b05c595474cc93e3a77` |
| `js/modules/household-360.js` | 189842 | `11a667b2fb1db579c04991bc3fbce74f90fc1cf3cabc85710479586f4320b152` |
| `js/modules/party.js` | 384987 | `27e2d8f20ff8a6ffc5ac0a108f8168022b595836fc6d3ccff760619221543b6d` |
| `js/modules/personnel_skills.js` | 46971 | `6210e65a154ccfe43a9c3f7d2ff5c60ed1ecae74a01c4342c82d059fd0d34e3c` |
| `js/modules/visit_skills.js` | 18711 | `6410e77ab2da34f324581b5404c2c164030773905d1c14f1082ceba438f7e66a` |
| `login_bg_dark.jpg` | 514042 | `8291bbd03bbd525c2df497a86d387b9bc0f4a76fc5fe54f87bbe130334dd1a6d` |
| `login_bg.jpg` | 506378 | `3c990adf0ef9e212287975e23d19b9b258f7f8e444ea9d5a9f08bdd01e453c62` |
| `logo.png` | 359331 | `2109aea7683999bbfd9791e57089c7c9b4e42e753a5fb8a51d6cd6a37dd26fc1` |
| `main.js` | 203419 | `aa195c332625782e3e6435c84f30afc953fe1e4cd569529bf15fba8a3e848bde` |
| `mobile_upload.html` | 21961 | `2d5cee4efce240979f54da40a69d5c0f740f4e9215bc51ca0c59599ea229678e` |
| `package.json` | 178 | `3d4728ffd05a17a4033b38ee772adbfb3bc8bf800ef55d5b82f6a383e30ce8a5` |
| `preload.js` | 10070 | `67c41c50ca616a8f4e413355619357a5bbcd356226fe539730b9991f44226095` |
| `renderer.js` | 2422632 | `e1fe4e35c4de0183bcf0e5161c921b9f9cfbe3627089cbaafc244cec8e64f3e0` |
| `server/mobile-upload-server.js` | 9885 | `e7bad04c564d1b653ada5b258e5825afd2de538c47eae89b73049d6111a074fa` |
| `style.css` | 180887 | `ab13b54771f392851d6f2732a53e3565edbe634d210ef2c72f60a814b624ab55` |
