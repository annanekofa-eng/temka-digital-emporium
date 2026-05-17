
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_status text,
  ADD COLUMN IF NOT EXISTS auto_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_delivered_by bigint,
  ADD COLUMN IF NOT EXISTS auto_error_note text;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS recipient_username text;

CREATE INDEX IF NOT EXISTS idx_orders_auto ON public.orders (is_auto, auto_status, created_at DESC);

INSERT INTO public.message_templates (key, title, body, is_active) VALUES
  ('auto_order_accepted', 'Авто-заказ принят', '📦 <b>Заказ принят</b>

Номер: <code>{{order_number}}</code>
Товар: {{items}}
Получатель: {{recipient}}
Сумма: ${{total}}

⏳ Ожидайте выдачи — мы уведомим, как только товар будет передан.', true),
  ('auto_order_delivered', 'Авто-заказ выдан', '✅ <b>Ваш заказ выдан!</b>

Номер: <code>{{order_number}}</code>
{{items}}
Получатель: {{recipient}}

Проверьте получение в Telegram. Спасибо за покупку!', true),
  ('auto_order_error', 'Авто-заказ ошибка', '❌ <b>Не удалось выдать заказ</b>

Номер: <code>{{order_number}}</code>
Причина: {{reason}}

Сумма ${{total}} возвращена на ваш баланс.', true)
ON CONFLICT (key) DO NOTHING;
