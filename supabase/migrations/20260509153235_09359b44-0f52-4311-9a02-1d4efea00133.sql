
-- Link existing VIETO products to categories
UPDATE products SET category_id='vieto-tshirts',
  description='Хлопковая футболка plain-cut, 240 г/м². Чёрный graphic-принт. Размеры S–XXL.'
  WHERE id='a4136c50-55a6-4001-8de8-aac90454e5e7';

UPDATE products SET category_id='vieto-hoodies',
  description='Тяжёлый худи 480 г/м², брашированный флис. Свободный крой, рибана на манжетах. S–XXL.'
  WHERE id='674b7dc1-0a16-4a4d-9e12-f644cefb92f0';

UPDATE products SET category_id='vieto-caps',
  description='Шестипанельная кепка с вышитым логотипом. Регулируемый ремешок. Чёрный/белый.'
  WHERE id='066fe8ec-64f5-4ee9-ac65-9584805d6623';

UPDATE products SET category_id='vieto-tshirts',
  description='Оверсайз футболка с авторской graphic-печатью «Noise». Плотный хлопок 220 г/м². S–XXL.'
  WHERE id='39507511-6715-4c2a-9ed8-ec0d0e3d5ec6';

-- Add a few extra products for each category
INSERT INTO products (id, title, subtitle, description, price, stock, category_id, project_id, product_type, sort_order, is_active, image)
VALUES
  (gen_random_uuid(), 'Футболка «Pulse»', 'Hot drop · ограниченная серия',
   'Графический принт «Pulse». 100% хлопок 240 г/м². Размеры S–XXL.',
   38, 25, 'vieto-tshirts', 'vieto', 'simple', 12, true, NULL),
  (gen_random_uuid(), 'Худи «Soft»', 'Лёгкий худи на каждый день',
   'Лёгкий худи 320 г/м², мягкий внутренний ворс. Универсальный крой. S–XXL.',
   65, 18, 'vieto-hoodies', 'vieto', 'simple', 22, true, NULL),
  (gen_random_uuid(), 'Кепка «Mesh»', 'Trucker · сетка сзади',
   'Trucker-кепка с сетчатой задней частью и фронтальной нашивкой. One size.',
   22, 30, 'vieto-caps', 'vieto', 'simple', 32, true, NULL),
  (gen_random_uuid(), 'Худи «Zip»', 'На молнии',
   'Худи на молнии, 380 г/м², боковые карманы. Свободный крой. S–XXL.',
   95, 12, 'vieto-hoodies', 'vieto', 'simple', 23, true, NULL);
