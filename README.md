# Chess.com Bot - Stockfish 17.1

Bot cờ vua tự động cho Chess.com sử dụng engine Stockfish 17.1 với NNUE.

## Tính năng chính

### 🎯 Phân tích nước đi
- Tự động tìm nước đi tốt nhất với engine Stockfish 17.1
- Điều chỉnh độ sâu phân tích (depth)
- Hiển thị evaluation bar (thanh đánh giá) trực quan ngay trong ván cờ

### 🤖 Chế độ tự động
- **Auto-run**: Tự động phân tích và tìm nước đi tốt nhất
- **Auto-move**: Tự động phân tích, tìm nước đi tốt nhất và thực hiện nước đi
- **Auto new game**: Tự động bắt đầu ván mới
- **Random delay**: Thêm độ trễ ngẫu nhiên để giống người chơi thật

### 📊 Giao diện
- Nút điều khiển ở góc dưới phải
- Panel cài đặt gọn gàng, dễ sử dụng
- Evaluation bar hiển thị trực quan tình thế

## Cài đặt

### 1. Cài Tampermonkey

### 2. Cài script
1. Mở Tampermonkey
2. Creat a new script
3. Paste nội dung script `chess_bot.js`
4. Lưu script

### 3. Truy cập Chess.com
- Vào [chess.com/play/computer](https://www.chess.com/play/computer) và sử dụng

## Hướng dẫn sử dụng

### Mở bảng điều khiển
- Click vào **nút tròn** ở góc dưới phải màn hình
- Giao diện sẽ hiện ra

### Điều chỉnh độ sâu phân tích
- Nhấn phím từ `Q-M` trên bàn phím
- Depth càng cao = phân tích càng mạnh nhưng chậm hơn

### Bật/tắt Auto-run
1. Mở panel điều khiển
2. Tích chọn **"Auto-run"**
3. Tự động tìm nước tốt nhất

### Bật/tắt Auto-move
1. Mở panel điều khiển
2. Tích chọn **"Auto-move"**
3. Tự động đi nước tốt nhất

### Bật/tắt Auto new game
1. Mở panel điều khiển
2. Tích chọn **"Auto New Game"**
3. Sau khi ván đấu kết thúc, bot sẽ tự động bắt đầu ván mới

### Random delay
1. Mở panel điều khiển
1. Nhập thời gian (giây)
2. Bot sẽ thêm độ trễ ngẫu nhiên giữa các nước đi

### Đọc evaluation bar
- **Thanh trắng/đen**: Thể hiện ưu thế của mỗi bên
- **Số dương (+)**: Quân trắng đang ưu thế
- **Số âm (-)**: Quân đen đang ưu thế
- **M_X số**: Mate trong X nước
- **D_Y + số**: Độ sâu Y hiện tại

## Phím tắt

| Phím | Chức năng |
|------|-----------|
| `Q-M` | Đặt depth = 1-26 |
| Click nút tròn | Mở/đóng panel |

## Lưu ý

⚠️ **Chú ý quan trọng**:
- Sử dụng bot có thể vi phạm điều khoản của Chess.com
- Chỉ dùng cho mục đích học tập và nghiên cứu
- Tác giả không chịu trách nhiệm về việc tài khoản bị khóa

---

*Script được phát triển cho mục đích giáo dục. Sử dụng có trách nhiệm.*