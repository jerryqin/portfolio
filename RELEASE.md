# Release 构建与发布流程

> 项目：portfolio · Bundle ID：`com.jerryqin.portfolio` · Team：`QR6GA3K5GC`

---

## 版本号规则

| 字段 | 位置 | 说明 |
|------|------|------|
| `MARKETING_VERSION` | `project.pbxproj` | 对外版本号，如 `0.1.2`，每次发布新功能时递增 |
| `CURRENT_PROJECT_VERSION` | `project.pbxproj` | Build 号（整数），每次提交 App Store / TestFlight 必须递增，如 `2 → 3` |

**修改方法**（两处同时改，Debug 和 Release 各一个 buildSettings 块）：

```bash
# 用 sed 批量修改，避免漏改
sed -i '' 's/MARKETING_VERSION = 0\.1\.2/MARKETING_VERSION = 0.1.3/g' \
  ios/portfolio.xcodeproj/project.pbxproj

sed -i '' 's/CURRENT_PROJECT_VERSION = 2/CURRENT_PROJECT_VERSION = 3/g' \
  ios/portfolio.xcodeproj/project.pbxproj
```

---

## 构建 Release IPA

```bash
# 在项目根目录执行
xcodebuild \
  -workspace ios/portfolio.xcworkspace \
  -scheme portfolio \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -allowProvisioningUpdates \
  2>&1 | tee /tmp/xbuild_release.log

# 快速查看结果
grep "error:\|BUILD FAILED\|BUILD SUCCEEDED" /tmp/xbuild_release.log \
  | grep -v "^    export\|CLANG_ALLOW\|no-error\|^note\|^warning" | head -10
```

构建产物位置：
```
~/Library/Developer/Xcode/DerivedData/portfolio-*/Build/Products/Release-iphoneos/portfolio.app
```

---

## 打包 & 上传到 App Store Connect

### 方式一：Xcode 图形界面（推荐）

1. 打开 `ios/portfolio.xcworkspace`
2. 菜单 **Product → Archive**（需连接真机或选择 `Any iOS Device`）
3. Archive 完成后，**Xcode Organizer** 自动弹出
4. 选择刚生成的 Archive → **Distribute App**
5. 选择 **TestFlight & App Store** → Next
6. 勾选 **Upload** → Next → 让 Xcode 自动管理签名 → Next → Upload

上传完成后约 5-10 分钟在 App Store Connect 后台可见。

### 方式二：命令行 `xcrun altool`（无需打开 Xcode）

```bash
# 1. Archive
xcodebuild archive \
  -workspace ios/portfolio.xcworkspace \
  -scheme portfolio \
  -configuration Release \
  -archivePath /tmp/portfolio.xcarchive \
  -allowProvisioningUpdates

# 2. 导出 IPA（需要 ExportOptions.plist）
xcodebuild -exportArchive \
  -archivePath /tmp/portfolio.xcarchive \
  -exportPath /tmp/portfolio_ipa \
  -exportOptionsPlist ios/ExportOptions.plist \
  -allowProvisioningUpdates

# 3. 上传（替换为你的 App Store Connect API Key 或 Apple ID）
xcrun altool --upload-app \
  -f /tmp/portfolio_ipa/portfolio.ipa \
  -t ios \
  --apiKey <KEY_ID> \
  --apiIssuer <ISSUER_ID>
```

`ExportOptions.plist` 示例（保存到 `ios/ExportOptions.plist`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>teamID</key>
  <string>QR6GA3K5GC</string>
  <key>uploadSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
```

---

## 发布到 TestFlight

1. 登录 [App Store Connect](https://appstoreconnect.apple.com)
2. 进入 **我的 App → portfolio → TestFlight**
3. 等待构建处理完成（状态从「正在处理」变为「准备提交」）
4. 点击构建旁的 **+**，添加测试员或外部测试组
5. 外部测试需通过审核（通常几小时内）；内部测试员无需审核，立即可用

---

## 已知问题

| 问题 | 状态 | 说明 |
|------|------|------|
| Debug 构建链接失败 | 已知，不影响发布 | `react-native-screens` prebuilt `.a` 引用 `Sealable::Sealable()` 符号，仅在 `#ifdef REACT_NATIVE_DEBUG` 下存在；Release 构建正常 |
| `expo-configure-project.sh` | 已 stub | Build Phase 中仍有残留脚本，但已替换为写空文件的 stub，不影响构建 |

---

## 常用命令速查

```bash
# 启动 Metro 开发服务器（本地调试用）
npx react-native start

# 安装到已连接的真机（覆盖 TestFlight 版本！谨慎使用）
npx react-native run-ios --udid 00008110-000629862186801E

# 重新安装 pods（修改 Podfile 或 npm 包后执行）
cd ios && pod install && cd ..

# 清理 Metro 缓存
npx react-native start --reset-cache
```
