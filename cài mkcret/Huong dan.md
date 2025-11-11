Cài node js trên gg https://nodejs.org/en/download/current
Dán file mkcert.exe vào system 32
Cách kiểm tra ip của máy bằng cách chạy lệnh ipconfig trong Terminal trong project ( VD: IPv4 Address. . . . . . . . . . . : 192.168.1.8)
Đổi địa chỉ ip theo từng máy cá nhân ở 2 file js và đổi file.pem của server.js ở dòng 11 12 2 (file .pem đã tạo )
Rồi cài mkcert theo ảnh minh họa ( Tạo mkcert.pnp )





npm install -g mkcert // cài mkcert
mkcert -install
mkcert 192.168.133.17 localhost 127.0.0.1 //đổi 192.168..... theo ip theo máy


node -v // kiểm tra đã cài node js chưa
npm -v
npm install



Cách chạy code : node server.js