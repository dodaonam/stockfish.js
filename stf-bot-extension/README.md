# STF Bot cho Windows

STF Bot là Chrome extension Manifest V3 dùng Stockfish cục bộ qua Chrome Native Messaging để phân tích thế cờ trên Chess.com.

```text
Chess.com -> extension -> Native Messaging host -> stockfish.exe
```

## Thành phần cần có

- Google Chrome trên Windows 64-bit.
- Stockfish Windows binary phù hợp với CPU.
- Chỉ cần file executable Stockfish. NNUE đã được nhúng trong binary Stockfish phân phối hiện tại; không cần DLL hoặc file `.nnue` rời.

STF Bot không tải, sao chép hoặc sửa đổi binary Stockfish.

## Cài đặt

1. Chạy `STFBot-Setup-YYYY.MM.DD.exe` và chọn trực tiếp file executable Stockfish (`.exe`). Có thể chọn binary AVX2, BMI2 hoặc SSE4.1 phù hợp với CPU.
2. Setup cài native host vào `%LOCALAPPDATA%\STFBot` và đăng ký host cho Windows user hiện tại.
3. Mở `chrome://extensions`, bật Developer mode, chọn Load unpacked và chọn thư mục `stf-bot-extension\extension\`.
4. Mở popup STF Bot. Trạng thái host xác nhận executable và cấu hình đã được tìm thấy.
5. Mở trang Chess.com thuộc `/play/`, `/game/` hoặc `/puzzles/`.

Control panel giữ lại Auto Run, Auto Move và random delay từ LC0 Bot. STF Bot chỉ dùng search depth:

- Go Depth mặc định `12`, giới hạn `1..20`.
- Limit Strength tắt mặc định.
- Elo mặc định `2000`, giới hạn `1500..3000`, bước `100`.
- Khi Limit Strength tắt, trường Elo bị khóa và không thể chỉnh sửa.

Stockfish nhận lệnh UCI dạng `go depth <depth>`. Khi Limit Strength bật, host gửi `UCI_LimitStrength true` và `UCI_Elo`; khi tắt, host gửi `UCI_LimitStrength false`.

## Build native host và Setup

Maintainer cần Python 3.12+ và Inno Setup 6+:

```powershell
cd stf-bot-extension
.\build-native-host.ps1
iscc "/DMyAppVersion=2026.08.19" STFBot.iss
```

Build tạo `dist\stf-native-host.exe` và `dist\STFBot-Setup-YYYY.MM.DD.exe`.

Installer ghi các file sau trong `%LOCALAPPDATA%\STFBot`:

- `stf-native-host.exe`
- `engine-config.json`
- `com.stfbot.nativehost.json`

Native host đăng ký tại:

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.stfbot.nativehost
```

STF Bot có extension key, native host name, config, storage namespace và installer riêng với LC0 Bot.

## Release

Workflow `.github/workflows/release-stf-bot.yml` tạo release riêng theo tag `stfbot-vYYYY.MM.DD` và upload asset `STFBot-Setup-YYYY.MM.DD.exe`.

## License

Stockfish được phân phối theo GPLv3. Khi phân phối lại binary hoặc sản phẩm chứa binary, cần tuân thủ GPLv3 và cung cấp license/source theo yêu cầu của giấy phép.

Việc sử dụng extension để tự động chơi trên dịch vụ trực tuyến phải tuân thủ điều khoản của dịch vụ đó.
