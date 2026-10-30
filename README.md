# Bộ công cụ phân tích cờ vua — Stockfish & Lc0

Repository tập hợp các công cụ tích hợp **Stockfish** và **Leela Chess Zero (Lc0)** với Chess.com và Lichess. Các sản phẩm nằm trong `apps/`, phân nhóm theo **engine chính**; mỗi sản phẩm có hướng dẫn cài đặt và kiểm thử riêng.

## Sản phẩm

| Sản phẩm | Thư mục | Engine chính | Website | Cách chạy engine |
|---|---|---|---|---|
| LC0 Unified | [`apps/lc0/unified/`](apps/lc0/unified/README.md) | Lc0 | Chess.com + Lichess | Native Messaging, Windows/Ubuntu |
| LC0 Chess.com | [`apps/lc0/chesscom/`](apps/lc0/chesscom/README.md) | Lc0 | Chess.com | Native Messaging, Windows/Ubuntu |
| LC0 Lichess | [`apps/lc0/lichess/`](apps/lc0/lichess/README.md) | Lc0 | Lichess | Native Messaging, Windows/Ubuntu |
| Stockfish Web | [`apps/stockfish/chesscom-web/`](apps/stockfish/chesscom-web/README.md) | Stockfish JS/WASM | Chess.com | Web Worker |
| Stockfish Native | [`apps/stockfish/chesscom-native/`](apps/stockfish/chesscom-native/README.md) | Stockfish | Chess.com | Native Messaging, Windows |

Các sản phẩm là độc lập. **Không bật đồng thời nhiều bot trên cùng một trang cờ.** Bản Unified dùng Lc0 để tìm nước; Stockfish WebAssembly trong bản này chỉ phục vụ evaluation bar.

## Cấu trúc

- `apps/lc0/` — các ứng dụng dùng Lc0 làm engine chính.
- `apps/stockfish/` — các ứng dụng dùng Stockfish làm engine chính.
- `legacy/userscripts/` — userscript Tampermonkey đời cũ, giữ để tham khảo.
- `stockfish_engine/` — tài nguyên Stockfish JS/WASM. **Giữ nguyên đường dẫn** vì mã nguồn và URL CDN/GitHub Raw đang phụ thuộc.
- `docs/` — tài liệu kiến trúc, phát triển, phát hành và hình ảnh minh họa.
- `.github/workflows/` — chỉ build/release Windows Setup khi có push/merge phù hợp vào `main`.

## Bắt đầu

Đọc README của sản phẩm tương ứng trong bảng trên. Extension được cài bằng **Load unpacked** từ đúng thư mục `extension/` chứa `manifest.json` (đối với Stockfish Web, từ thư mục `apps/stockfish/chesscom-web/`).

Người dùng LC0 hoặc Stockfish native cần cài/cung cấp engine tương ứng. Windows Setup chỉ cài Native Messaging host; không tích hợp hoặc tải engine native.

## Tài liệu dành cho người phát triển

- [Kiến trúc](docs/architecture.md)
- [Phát triển và kiểm thử local](docs/development.md)
- [Build và phát hành](docs/releasing.md)
- [GitHub Releases](https://github.com/dodaonam/stockfish.js/releases)

## Mã nguồn cũ

- [Chess.com Stockfish userscript](legacy/userscripts/chesscom-stockfish.user.js)
- [Lichess Stockfish Coach userscript](legacy/userscripts/lichess-stockfish-coach.user.js)

Các userscript này chỉ được lưu trữ trong `legacy/` để tham khảo, **không còn được bảo trì hoặc kiểm thử**. Việc chuyển chúng vào `legacy/` cố ý thay đổi các URL GitHub Raw cũ; không duy trì bản sao hay đường dẫn tương thích tại repository root.

## Sử dụng có trách nhiệm

Chỉ sử dụng công cụ theo quy định của website, giải đấu hoặc môi trường được phép. Không sử dụng engine assistance hay tự động thực hiện nước đi để vi phạm quy định Fair Play trong các ván đấu trực tuyến.
