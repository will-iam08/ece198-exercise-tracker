# Motion Log · ESP32 与 iPhone 联调

本版使用原来的 USB-C 经典 ESP32 DevKit（DOIT ESP32 DEVKIT V1 / 4 MB），以及组员仓库中的 MPU6050、MAX30102 和 128×64 SSD1306 OLED。iPhone 主动发指令，设备使用真实传感器计数并返回状态。默认 BLE 模式上电即可连接，无需网络账号、设备令牌或串口 T 命令。固件入口为 `Firmware/MotionTrack/MotionTrack.ino`。

## 接线

断开供电后接线，按照板子丝印上的 GPIO 编号对应。下表按组员的 3.3 V 兼容 breakout 模块。所有模块共地，确认各模块的电源端支持 3.3 V，再接开发板 3V3。

| 模块 | SDA | SCL | 电源/备注 |
|---|---|---|---|
| SSD1306 OLED，128×64 | GPIO21 | GPIO22 | VCC→3V3，GND→GND；自动尝试 0x3C、0x3D |
| MAX30102 心率模块 | GPIO25 | GPIO26 | 3.3 V 兼容的电源输入→3V3，GND→GND；0x57 |
| MPU6050 | GPIO32 | GPIO33 | VCC→3V3，GND→GND；AD0 为低，0x68 |
| 可选实体按钮 | GPIO27 | GND | 两端跨接，内置上拉；按下为低。手机控制可独立使用 |

USB 线连接 ESP32 和 Mac 时用于上传、供电及查看 115200 波特率日志。之后仍须给 ESP32 供电。

## 上传 ESP32

选择以下一种方式。烧录会替换板上的程序。请先保留现有源工程。

1. **PlatformIO**：打开 Firmware 文件夹，选择默认环境 doit，在 ESP32 接入后点 Upload。platformio.ini 已固定平台和主要传感器依赖，可用命令 pio run -e doit -t upload。若有多个串口，显式指定实际板子的端口。
2. **Arduino IDE**：打开 Firmware/MotionTrack/MotionTrack.ino，保留整个文件夹。选择 Espressif Arduino ESP32 2.0.17、DOIT ESP32 DEVKIT V1、4 MB；如可选，分区选择 Huge APP。安装 SparkFun MAX3010x Pulse and Proximity Sensor Library 1.1.2、Adafruit SSD1306 2.5.17（安装其 GFX 和 BusIO 依赖）、SoftWire 2.0.10 和 AsyncDelay 1.1.2。选实际 USB 串口并 Upload。BLE 模式无需 secrets.h。

## 更新 iPhone 并开始训练

打开同包 MotionLog.xcodeproj。连接 iPhone，在 Xcode 顶部选择自己的手机，按 ⌘R。此步骤将手机上早期只支持接收的版本更新为可控制版本。首次从仓库安装时，在 Signing & Capabilities 选择自己的开发团队；若 Bundle ID 已被占用，请改为自己的唯一标识。

1. ESP32 上电时让 MPU 静止约 2 秒。App 选 My tracker → Scan for tracker → Motion Log。
2. 选 Biceps curl、Shoulder press 或 Back row，设 1–99 次目标并点 Start workout。设备按所选动作的计数规则运行。原仓库包含三种计数器；动作种类由手机选择。弯举传感器固定于前臂；肩推和划船按组员程序的提示固定在上臂。
3. 训练前将指尖稳定贴在 MAX30102 上。读数有效后自动进入计数；点 Skip heart-rate check 也可进入。运动到目标次数后进入训练后心率测量，可测量或跳过。App 分开显示两次有效 BPM。时长为从开始到完成或提前结束的整场秒数（含心率测量）。
4. 中途点 End workout 可提前结束。手机断线时 ESP32 继续运行；重新扫描连接后读取设备的当前快照。可选实体按钮开始/结束，首次默认弯举 10 次，以后使用设备上次开始的动作与目标。关机后当前训练清除。
5. 首次验收建议把目标设为 2，对照人工计数、OLED、手机，检查三种动作、两次心率、提前结束、断开再连接。佩戴位置和阈值需要组员拿真实动作校准。

硬件初始化失败时，App 会显示 Hardware setup required；查看 OLED 或 115200 串口的具体提示，校正后复位。心率模块离线可跳过测量。采样与计数来自 firmware，界面 Demo 数据只在 Demo 页使用。

## BLE 与原网站模式

服务、状态和控制 UUID 的第一段均为 45583198，中间分别为 0001、0002、0003，其余均为 4BAD-9000-000000000065。状态特征 Read/Notify，每次通知为完整快照；控制特征 Write with response。指令含版本、操作（1 开始/2 停止/3 跳过当前心率）、动作、目标和预期阶段，防止重复执行已过时的阶段操作。手机只按 ESP32 回传的状态更新训练画面。17 字节状态快照 v3 包括训练阶段、计数、时间、动作、目标、硬件状态与前后 BPM。完整定义见 MotionTrack/WorkoutWire.h 与 iOS Tracker.swift。

可选 website 编译环境保留原仓库 Wi-Fi/HTTP 的网站控制流程，需从 secrets.example.h 建立本机 secrets.h，并填入你自己的服务器地址及凭据。每次烧录选择一种控制模式。原始传感器与网站代码来源为 https://github.com/will-iam08/motiontrack-esp32 ，基线提交 cd07592a45e699d91b4bc5cfe206dcfe0179d262。BLE 模式不向网站同步数据。

## 已验证范围

已为 DOIT ESP32 DevKit V1 编译默认固件与可选网站模式，已完成 iPhone 真机目标构建。通过原仓库的 27 项主机测试，以及本次增加的三种动作状态包 C++→Swift 解码、重复开始、阶段过期指令、跳过、停止和结束读数检查。未在实际佩戴的传感器或蓝牙链路上验证。实物精度、供电、电路连通与真机通信需要在板子接好后验证。
