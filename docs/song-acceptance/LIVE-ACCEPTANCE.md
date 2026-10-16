# ผู้ดูแลทดสอบเสียงจริง: SBR-001 และ SBR-Audio-NodeLink เดิมเท่านั้น

เอกสารนี้เป็นแผน ไม่ใช่คำอนุญาตให้ Deploy/Restart/Sync/เปลี่ยน env หรือให้ Codex เชื่อม Production ห้ามเปิดบอทหรือ server เพิ่มและไม่ส่ง Token/Database URL มาให้ Codex ใช้แผน Backup/Rollback ใน SBR docs/PLAYBACK-REVIEW.md หากเจ้าของอนุญาต rollout ภายหลัง

## ก่อนเริ่ม

- รวบรวมในครั้งเดียว: URL และเวอร์ชันต้นฉบับของ STARTRIP และแสงสุดท้าย; ยืนยัน Sky High URL https://soundcloud.com/elektronomia/elektronomia-sky-high (ไม่ใช่ Part II/Remix); URL เสียงอ้างอิงที่อนุญาตพร้อมตำแหน่งช่วงเทียบ; commit/image/start-command ของทั้งสองบริการจากข้อมูลที่มีอยู่
- บันทึก deploy SHA ที่รันจริง อย่าอ้างว่าทดสอบ review branch ถ้า Botkeep ยังรัน 93103ec หรือโค้ดอื่น จับคู่ชื่อ search node/player node กับ SBR-Audio-NodeLink จริง; ไม่เปลี่ยน LAVALINK_ONLY_NODE/debug/env เพื่อให้จับคู่ได้
- การกด play/skip/loop อาจบันทึก history/session/settings ลง Neon ตามปกติ แผนนี้ยังไม่ได้อนุญาตผลกระทบนั้น หากห้ามเขียน Neon โดยเด็ดขาด ให้สังเกตและเก็บ log จากการใช้งานปกติเท่านั้น รอเจ้าของอนุญาตหน้าต่างทดสอบและผลกระทบปกติก่อนสั่งการ
- ใช้ห้องที่อนุญาตและ queue ว่าง ไม่ลบ cache, favorites, playlists, history หรือ session เดิม ไม่ Restart เพื่อเอา startup log

## ชุดฟังเสียง

1. กำหนด label SONG-01/02/03 และเวลาพร้อม timezone (เช่น Asia/Bangkok) ค้น `yt:STARTRIP Julia (CV: Aimi)`, `yt:แสงสุดท้าย Bodyslam`, `sc:Elektronomia Sky High NCS Release` ผ่านคำสั่ง/Panel เดิม เลือกเฉพาะรายการที่ URL/ID/version ตรงต้นฉบับ หากไม่พบ ให้หยุดเคสนั้น ไม่เลือก Cover/Remix/ชื่อคล้าย
2. เก็บผล search ที่เลือก: URI, sourceName, ID, artist, length, ISRC เมื่อมี และ search node เทียบ player node/NodeLink resolved identity บันทึก newTrack/pluginInfo.mirroredTrack เมื่อมี Log ห้ามสรุปจากชื่อบน Panel อย่างเดียว
3. ฟังช่วงเดียวกับเสียงอ้างอิง 10–30 วินาทีและอีกช่วงกลางเพลง จดว่าเสียงตรงต้นฉบับจริงหรือไม่, time-to-first-audio, เงียบ/BGM/cover/เสียงซ้อน ถ้าจะเก็บเสียง ต้องได้รับอนุญาตและไม่บันทึกเสียงสนทนาของผู้อื่น
4. Queue A/B/C ตามลำดับ Skip A หนึ่งครั้ง: A หยุด B เริ่มครั้งเดียว Pause/Resume B แล้วปล่อย B จบเอง C ต้องเริ่มถูกเพลง ไม่เปลี่ยนแหล่งเสียงเงียบ ๆ
5. แยกอีกรอบให้เพลงต่อกันตามธรรมชาติรวม >=10 นาที (เพิ่มรอบหรือเพลงที่ได้รับอนุญาตถ้าระยะเวลาไม่พอ) ไม่กด Skip ระหว่างรอบนี้ จด gap/stall/position และ RAM/CPU จาก dashboard เดิม ไม่อ้าง mock-test RSS เป็น RAM Production
6. เปรียบเทียบค้นครั้งแรก/ครั้งซ้ำโดยไม่ clear cache หากไม่มี cache log ให้ระบุ unknown ไม่บังคับ cold cache ด้วยการลบข้อมูล
7. สังเกต recovery ที่เกิดเอง: disconnect/503/1006/4014, retry/drop และลำดับคิวหลังกลับมา ต้องรักษา identity เพลงเดิม 4014 อาจเกิดจาก kick/move จึงไม่บังคับบอท rejoin เอง ผู้ดูแลยืนยันห้องและสั่งเล่นอีกครั้งเมื่อเหมาะสม ไม่จงใจตัด node/Restart/kick เพื่อทดสอบโดยไม่มีอนุญาตแยก

## Log ที่ต้องเก็บทั้งสองฝั่ง

ช่วงก่อนเคส 30 วินาทีถึงหลังผิดพลาด/จบ 60 วินาที พร้อม timezone/label เดียวกัน

SBR: SEARCH OK/EMPTY/NODE FAILED, RESOLVED IDENTITY, SELECTED IDENTITY, PLAY REQUEST, TRACK START/EXCEPTION/STUCK, RETRY QUEUED/TRACK DROPPED, VOICE CONNECTED/CLOSED, NODE RECOVERY, CLOSE/RECONNECTING/DISCONNECT/READY, PLAYBACK PROGRESS พร้อม queue ก่อนหลังและสิ่งที่ผู้ฟังได้ยิน

NodeLink: selected source/ID และ API resolved ID, cache read/hit/binding ถ้ามี, Track resolution identity, client/playability/cipher/HTTP/HLS/stream exception+cause, mirror/newTrack identity, TrackEnd reason, Voice close/reconnect/position/packet deficits ที่ log อยู่แล้ว Field ที่ไม่มีให้ระบุ unavailable ไม่เปิด debug หรือแก้ Production เพื่อเพิ่ม field ก่อนอนุญาต

ปิดบัง auth/token/password/cookies/voice session/key, signed URL query และ DATABASE_URL ใช้ alias ของ guild/user/channel ให้เหมือนกันทั้งสอง log ไม่ส่ง .env หรือข้อมูลส่วนตัว Neon

## เกณฑ์รายงาน

- PASS: เวอร์ชัน/URI ถูกยืนยัน, หลักฐานเสียงเทียบอ้างอิงและผู้ฟังตรงเพลง, source/ID ไม่เปลี่ยนโดยไม่ได้เลือก, Queue/Skip/Pause/Resume/natural transition และ >=10 นาทีผ่าน พร้อม deploy version ที่ยืนยัน
- FAIL: พบเสียงผิดจริง/ผิดลำดับ/เสียงเงียบหรือ stall ที่ทำซ้ำได้ พร้อมเวลา/Log โดยแยกสาเหตุที่ยังไม่ทราบ
- BLOCKED: network/สิทธิ์/เวอร์ชัน Production ไม่พร้อมจนทำเคสไม่ได้ ไม่ตีความเป็น NodeLink failure อัตโนมัติ
- UNVERIFIED: ยังไม่มีเสียงอ้างอิง/ผู้ฟัง/Log/identity ที่พอ แม้ TRACK START หรือ packet count ดูปกติ

แบบบันทึก: label | deploy SHA | เวลา+timezone | selected URI/source/ID/version | search/player node | actual resolved source/ID | sample offset | reference source | ได้ยินอะไร | queue before/after | gap/stall | RAM/CPU | Log timestamp | status
