# LC0 Bot cho Windows

LC0 Bot là Chrome extension Manifest V3 chạy ở chế độ **Load unpacked**. Nó
phân tích thế cờ Chess.com bằng bản Lc0 Windows CPU/oneDNN cục bộ qua Chrome
Native Messaging.

```text
Chess.com → extension → Native Messaging host → lc0.exe
```

## Yêu cầu

- Google Chrome trên Windows 64-bit có thể chạy ứng dụng x64.
- Repository này đã được clone về máy.
- Bản **Windows CPU/oneDNN** của Lc0 do người dùng tự tải từ
  [trang tải chính thức của Lc0](https://lczero.org/play/download/).
- Thư mục Lc0 phải có:
  - `lc0.exe`;
  - `dnnl.dll`;
  - đúng **một** file weight `*.pb.gz`, nằm ở thư mục Lc0 hoặc trong
    `weights/`.

LC0 Bot không tải, đóng gói, sao chép hoặc sửa đổi `lc0.exe`, DLL hay weight.

## Cài đặt cho người dùng

1. Tải file Setup duy nhất từ GitHub Release:
   `LC0Bot-Setup-YYYY.MM.DD.exe`.
2. Chạy Setup và chọn thư mục Lc0 đã giải nén. Setup chỉ cài Native Messaging
   host vào `%LOCALAPPDATA%\LC0Bot` và đăng ký nó cho Windows user hiện tại.
3. Mở `chrome://extensions`, bật **Developer mode**, chọn **Load unpacked** và
   chọn thư mục `lc0-bot-extension/extension/`.
4. Mở popup của LC0 Bot. Thông báo `Local LC0 host is ready.` xác nhận config,
   `lc0.exe`, `dnnl.dll` và weight hiện hợp lệ.
5. Mở trang Chess.com thuộc `/play/`, `/game/` hoặc `/puzzles/`. Nút **LC0**
   màu xanh mở bảng thiết lập Auto Run, Auto Move, thời gian tính nước và độ
   trễ ngẫu nhiên.

Nếu popup báo host không sẵn sàng, đọc nguyên văn lỗi: host phân biệt rõ thư
mục Lc0 bị di chuyển, thiếu `lc0.exe`, thiếu `dnnl.dll`, không có weight hoặc
có nhiều weight.

## Đổi weight mà không chạy lại Setup

1. Thay file `*.pb.gz` cũ bằng weight mới trong thư mục Lc0 hoặc `weights/`.
2. Đảm bảo tổng cộng chỉ còn đúng một file `*.pb.gz` ở hai vị trí đó; tên file
   có thể tùy ý.
3. Trong `chrome://extensions`, bấm **Reload** LC0 Bot; sau đó hard reload
   trang Chess.com nếu đang mở.

Native host được khởi động lại và quét weight mới. Chỉ cần chạy Setup lại khi
thư mục Lc0 bị di chuyển hoặc cần cấu hình lại host.

## Cập nhật extension

Khi chỉ có thay đổi trong `extension/`, Setup không đổi. Cập nhật source bằng
`git pull`, bấm **Reload** extension trong `chrome://extensions`, rồi hard
reload trang Chess.com.

MAIN world của extension chỉ làm việc với API bàn cờ Chess.com qua state nội bộ
`__LC0BotMain`. Storage, scheduler và Native Messaging chạy ở isolated world;
trang Chess.com không có đường gọi trực tiếp Native Messaging host.

## Phát triển và phát hành

Người dùng cuối không cần build local. Maintainer cần Python 3.12+ và Inno
Setup 6+ để build thủ công:

```powershell
cd lc0-bot-extension
.\build-native-host.ps1
iscc "/DMyAppVersion=2026.07.30" LC0Bot.iss
```

`LC0Bot.iss` tạo installer per-user, chỉ hỗ trợ kiến trúc chạy x64 và dùng fixed
public extension key. Nhờ đó Native Messaging host chỉ chấp nhận LC0 Bot mà
không yêu cầu người dùng nhập Extension ID.

Workflow `.github/workflows/release-lc0-bot.yml` chỉ build Setup khi push vào
`main` có thay đổi Native Host, build script/requirements, `LC0Bot.iss` hoặc
chính workflow. Thay đổi `extension/` không tạo Setup mới. Khi chạy, workflow:

1. kiểm tra cú pháp Python, JavaScript và manifest;
2. build `lc0-native-host.exe` bằng PyInstaller;
3. build Setup bằng Inno Setup;
4. tạo hoặc cập nhật Release theo ngày UTC `lc0bot-vYYYY.MM.DD`.

Release chỉ có một asset được upload: `LC0Bot-Setup-YYYY.MM.DD.exe`. GitHub có
thể hiển thị thêm hai source archive tự sinh (`.zip` và `.tar.gz`).

## Cấu trúc thư mục

- `extension/` — source unpacked Chrome extension.
- `native_host.py` — Native Messaging host và UCI client.
- `build-native-host.ps1`, `requirements-build.txt` — build host bằng
  PyInstaller.
- `LC0Bot.iss` — installer Inno Setup và đăng ký Native Messaging trên HKCU.
- `../.github/workflows/release-lc0-bot.yml` — CI build và upload Release.

`build/`, `dist/`, cache Python, PyInstaller spec và cấu hình runtime chứa
đường dẫn máy người dùng đều bị Git ignore.

## Giấy phép và sử dụng có trách nhiệm

Lc0, DLL và neural-network weights được người dùng lấy trực tiếp từ Lc0; dự án
này không phân phối chúng. Người dùng tự chịu trách nhiệm tuân thủ giấy phép
Lc0 và các điều khoản liên quan, cũng như quy định Fair Play của Chess.com.
