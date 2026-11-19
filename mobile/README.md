# Motion Log for iPhone and ESP32

Use an iPhone to select a biceps curl, shoulder press or back row, choose a target of 1–99 reps, and start or end a set. The ESP32 counts the selected movement, tracks elapsed time, checks heart rate before and after the set, and sends readings to the phone over Bluetooth Low Energy. The OLED and optional physical button also work with this firmware. [中文安装、接线和操作说明](README.zh-CN.md)

## Install the matching app and firmware

1. Wire the unpowered classic ESP32 DOIT DevKit V1 (4 MB). Use 3.3 V-compatible modules and tie their grounds together. Check the board's GPIO labels.

   | Module | SDA | SCL | Other connection |
   | --- | --- | --- | --- |
   | SSD1306 128×64 OLED | GPIO21 | GPIO22 | Address 0x3C or 0x3D |
   | MAX30102 pulse sensor | GPIO25 | GPIO26 | Address 0x57 |
   | MPU6050 motion sensor | GPIO32 | GPIO33 | AD0 low, address 0x68 |
   | Optional push button | | | GPIO27 to GND, internal pull-up |

2. Plug the ESP32 into a computer with a USB data cable. From this directory, use PlatformIO to build and upload the default Bluetooth firmware. Select the board's port with `--upload-port` if several devices are attached.

   ```sh
   cd Firmware
   pio run -e doit -t upload
   pio device monitor -b 115200
   ```

   Arduino IDE users can open [MotionTrack.ino](Firmware/MotionTrack/MotionTrack.ino) with the entire sketch directory. Board, partition and library versions are in [platformio.ini](Firmware/platformio.ini).

3. On a Mac, open `MotionLog.xcodeproj` in Xcode. In the MotionLog target's **Signing & Capabilities**, select your Apple development team. Use a unique bundle identifier if Xcode requests one. Select your iPhone as the destination and press **Run**. Allow Bluetooth access when prompted. Install this version if your phone has an earlier, read-only build.
4. Power the tracker and hold it still for about two seconds during calibration. On the phone, open **My tracker → Scan for tracker → Motion Log**. Select a movement, set a target of two reps for the first check and tap **Start workout**. Rest a finger on the pulse sensor or tap **Skip heart-rate check**. Compare the physical reps with the OLED and phone, then repeat the pulse check after reaching the target.
5. To try wireless operation, keep the ESP32 powered when you disconnect its USB cable. A phone disconnect during a workout leaves the set running on the board. Reconnect to read the current snapshot. Powering down the board clears its current session.

## Communication and verification

The default firmware runs locally without a Wi-Fi account or server. The phone selects the movement. The firmware applies the associated rep counter. The Demo tab generates simulated readings. The website workflow uses its own Wi-Fi firmware configuration and backend. See the [website firmware guide](../firmware/README.md) for credentials and deployment.

For Bluetooth diagnostics, compare the [packet definitions](Firmware/MotionTrack/WorkoutWire.h), [ESP32 Bluetooth service](Firmware/MotionTrack/Radio.cpp) and [iOS Bluetooth client](MotionLog/Tracker.swift). The app subscribes to full 17-byte v3 status snapshots and writes commands with a response. A completed workout includes elapsed seconds, reps, movement, target and available before/after BPM. The device checks the expected workout phase on incoming commands.

On macOS with Xcode installed, run `bash tests/run.sh` from this directory. It runs the sensor/flow checks against the integrated headers, exercises the device control flow and decodes its output with the app's Swift parser. For hardware acceptance, try each movement, skip a heart-rate check, end a set early, and reconnect mid-set. Check rep accuracy with the sensors in their intended wearing position. The automated checks do not measure physical rep accuracy or test the radio link.
