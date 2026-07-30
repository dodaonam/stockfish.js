# Bộ công cụ phân tích cờ vua cho Chess.com

Repository này gồm hai Chrome extension chạy ở chế độ **Load unpacked** và một
userscript Stockfish cũ. Mỗi thành phần dùng engine riêng; không có thành phần
nào cần hoặc nên chạy đồng thời với thành phần còn lại trên cùng một trang cờ.

| Thành phần | Thư mục | Engine | Cách hoạt động |
|---|---|---|---|
| Chess Bot | `chess-bot-extension/` | Stockfish | Extension tải worker Stockfish/WASM từ repository qua CDN hoặc GitHub raw. |
| LC0 Bot for Windows | `lc0-bot-extension/` | Lc0 CPU/oneDNN | Extension giao tiếp với Lc0 cục bộ qua Chrome Native Messaging, không dùng localhost. |
| Userscript cũ | `chess_bot.js` | Stockfish | Dùng với Tampermonkey; chỉ giữ để tham khảo và tương thích. |

## Chess Bot (Stockfish)

Extension Stockfish hỗ trợ phân tích thế cờ trên các trang Chess.com thuộc
`/play/` và `/game/`. Các tính năng hiện có gồm gợi ý nước đi, evaluation bar,
phân loại nước đi, Auto Run, Auto Move, Eval bar only, random delay và Auto New
Game.

### Cài đặt

1. Mở `chrome://extensions` trong Chrome.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Chọn thư mục `chess-bot-extension/` trong repository này.

Extension cần kết nối Internet để tải Stockfish worker/WASM từ CDN hoặc GitHub
khi cần khởi tạo engine.

### Sử dụng

1. Mở một trang Chess.com được hỗ trợ.
2. Dùng popup của extension để bật hoặc tắt toàn bộ extension.
3. Dùng nút tròn trên bàn cờ để mở bảng điều khiển.
4. Chọn các chế độ phù hợp, ví dụ Auto Run, Eval bar only, Auto Move hoặc Auto
   New Game.

## LC0 Bot for Windows

LC0 Bot dùng bản Lc0 Windows CPU/oneDNN do người dùng tự tải. Chrome giao tiếp
với một Native Messaging host cục bộ; không có FastAPI, Python runtime cho
người dùng cuối hoặc cổng localhost.

Hướng dẫn cài đặt, thay weight, build maintainer và CI nằm tại
[lc0-bot-extension/README.md](lc0-bot-extension/README.md).

## Userscript Stockfish cũ

`chess_bot.js` là userscript Tampermonkey cũ. Thành phần này không phải luồng
khuyến nghị cho người dùng mới; hãy ưu tiên Chrome extension Stockfish hoặc
LC0 Bot. Nếu vẫn dùng, cài Tampermonkey, tạo userscript mới và dán nội dung của
`chess_bot.js` vào đó.

## Lưu ý sử dụng

- Chỉ sử dụng công cụ này cho học tập, phân tích và luyện tập cá nhân.
- Tuân thủ quy định Fair Play của Chess.com và quy định của giải đấu hoặc nền
  tảng đang sử dụng.
- Không dùng để hỗ trợ thi đấu trực tuyến, đặc biệt trong ván xếp hạng hoặc
  giải đấu.
