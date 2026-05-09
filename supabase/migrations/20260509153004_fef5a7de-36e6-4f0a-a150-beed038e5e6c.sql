
UPDATE products SET
  description = 'Минималистичный логотип в стиле modern flat. Векторный исходник + 3 варианта цвета. Срок: 2-3 дня.',
  gallery = '[
    {"url":"https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=600","link":"https://dribbble.com/shots/16500000","title":"Logo · Apex"},
    {"url":"https://images.unsplash.com/photo-1626785774573-4b799315345d?w=600","link":"https://dribbble.com/shots/16500001","title":"Logo · Nova"},
    {"url":"https://images.unsplash.com/photo-1620207418302-439b387441b0?w=600","link":"https://dribbble.com/shots/16500002","title":"Logo · Pulse"},
    {"url":"https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=600","link":"https://dribbble.com/shots/16500003","title":"Logo · Vertex"}
  ]'::jsonb
WHERE id = '7b067705-50c5-4b51-896a-d8a6b640a532';

UPDATE products SET
  description = 'Полный фирменный стиль: логотип, палитра, типографика, гайдлайн. 4-6 недель работы, 2 раунда правок.',
  gallery = '[
    {"url":"https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?w=600","link":"https://www.behance.net/gallery/100000001","title":"Brand · Vela"},
    {"url":"https://images.unsplash.com/photo-1542744094-3a31f272c490?w=600","link":"https://www.behance.net/gallery/100000002","title":"Brand · Forge"},
    {"url":"https://images.unsplash.com/photo-1572044162444-ad60f128bdea?w=600","link":"https://www.behance.net/gallery/100000003","title":"Brand · Orbit"},
    {"url":"https://images.unsplash.com/photo-1561070791-2526d30994b8?w=600","link":"https://www.behance.net/gallery/100000004","title":"Brand · Lume"}
  ]'::jsonb
WHERE id = '29431508-799f-4657-a073-70764a546476';

UPDATE products SET
  description = 'Дизайн обложки + аватара канала Telegram. PNG в 2x для retina. Срок: 1-2 дня.',
  gallery = '[
    {"url":"https://images.unsplash.com/photo-1611605698335-8b1569810432?w=600","link":"https://t.me/example1","title":"Tech канал"},
    {"url":"https://images.unsplash.com/photo-1614728263952-84ea256f9679?w=600","link":"https://t.me/example2","title":"Crypto обложка"},
    {"url":"https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600","link":"https://t.me/example3","title":"Lifestyle канал"}
  ]'::jsonb
WHERE id = '1f538cc4-2c86-4ab1-8235-28a8eac5b034';

UPDATE products SET
  description = 'Авторский постер формата A2 для печати. Подходит для интерьера и подарков. PDF готовый к типографии.',
  gallery = '[
    {"url":"https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=600","link":"https://www.behance.net/gallery/200000001","title":"Поток"},
    {"url":"https://images.unsplash.com/photo-1551913902-c92207136625?w=600","link":"https://www.behance.net/gallery/200000002","title":"Глитч"},
    {"url":"https://images.unsplash.com/photo-1582738411706-bfc8e691d1c2?w=600","link":"https://www.behance.net/gallery/200000003","title":"Шум"},
    {"url":"https://images.unsplash.com/photo-1547891654-e66ed7ebb968?w=600","link":"https://www.behance.net/gallery/200000004","title":"Свет"}
  ]'::jsonb
WHERE id = 'ecd5f08f-8f7e-4d26-9aaf-296ad19cd062';
