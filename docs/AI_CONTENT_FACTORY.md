# AI Content Factory — Generation Architecture

## Mục tiêu

Viral AI Tool không khóa người dùng vào một model duy nhất. Người dùng chọn mục tiêu:

- **Economy**: ưu tiên chi phí thấp / local.
- **Balanced**: cân bằng tốc độ, chất lượng và chi phí.
- **Quality**: ưu tiên chất lượng đầu ra.

Model Router chọn model phù hợp dựa trên input, độ dài, độ phân giải, audio, provider đang khả dụng và trần chi phí.

## Luồng chuẩn

```text
Factory request
  -> validate input
  -> choose route
  -> estimate cost
  -> reserve app credits
  -> enqueue scene jobs
  -> provider adapter
  -> poll/webhook result
  -> verify output
  -> settle actual credits
  -> compose/export
```

Không trừ tiền/credit vĩnh viễn chỉ vì người dùng bấm Generate. Credit phải được **reserve** trước và chỉ **settle** khi job đạt trạng thái thành công theo policy.

## Model tiers hiện tại

### Economy

Ưu tiên:

1. WAN Local khi máy đủ khả năng và local provider khả dụng.
2. WAN 3.0 cloud.
3. Seedance 2.0 Mini.

### Balanced

Ưu tiên:

1. Veo 3.1 Fast khi request cần audio.
2. Gen-4.5.
3. Seedance 2.0 Fast.
4. WAN 3.0.

### Quality

Ưu tiên:

1. Seedance 2.5.
2. Veo 3.1.
3. Gen-4.5.

Danh sách là policy mặc định, không phải hard-code UI. Sau này backend có thể thay đổi thứ tự dựa trên latency, lỗi provider, giá hoặc A/B testing.

## Cost estimator

`services/generation/cost-estimator.js` trả về:

- model/provider
- thời lượng và resolution
- provider credits
- USD estimate nếu provider có đơn giá được biết
- pricing snapshot date

Estimate chỉ dùng để preview/reserve. Khi provider trả usage thực tế, settlement phải dùng actual usage nếu có.

## Security

- API key của Runway/Google/ByteDance không được gửi xuống renderer.
- Renderer chỉ gọi backend/native boundary.
- Provider secrets nằm ở backend hoặc secure OS storage.
- Log không ghi API key hoặc raw authorization header.
- Mỗi request tạo video phải có user/account scope và idempotency key.

## Batch factory

Một video quảng cáo 30–60 giây nên được chia thành scene jobs nhỏ thay vì một generation dài:

```text
Product brief
  -> 10 concepts
  -> 3 hooks/concept
  -> scenes
  -> generate scenes in parallel
  -> score/select
  -> voice/caption/music
  -> compose
  -> exports
```

Điều này cho phép tạo nhiều variation rẻ bằng model Economy rồi chỉ nâng cấp những scene tốt bằng model Quality.

## Pricing policy

Bảng giá trong catalog là snapshot để ước lượng, không được coi là giá bán cố định cho khách hàng. Giá bán của Viral AI Tool cần có lớp app-credit riêng để:

- hấp thụ thay đổi giá provider;
- có margin;
- tặng free credits;
- hỗ trợ subscription;
- retry provider mà không trừ người dùng hai lần.

## Bước triển khai tiếp theo

1. App credit ledger + durable reservation.
2. Generation job schema + queue/concurrency.
3. Runway provider adapter đầu tiên.
4. Factory batch API.
5. Factory UI.
6. Scene composer + export.
