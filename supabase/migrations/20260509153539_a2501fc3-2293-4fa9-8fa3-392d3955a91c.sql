
UPDATE products SET
  description = 'Официальная подписка Telegram Premium. Активация на ваш @username за 5–30 минут.',
  subtitle = 'Подписка с моментальной активацией'
WHERE id = '0972b777-cdcf-4d71-a0d3-b1344f1c4c2e';

UPDATE products SET
  description = 'Коллекционные NFT-подарки Telegram. Передача после оплаты за 5–30 минут.',
  subtitle = 'Коллекционные подарки Telegram'
WHERE id = 'fcb6b52d-ee7c-463c-97c2-3d90ca72b043';

UPDATE products SET
  description = 'Telegram Stars для оплат внутри Telegram. От 50 шт. Зачисление по @username.',
  subtitle = 'Внутренняя валюта Telegram'
WHERE id = '91908b22-5b38-4a32-9f55-c8a811b81863';

UPDATE products SET
  external_link = 'https://getgems.io/collection/rent',
  description = 'Аренда NFT-подарков на GetGems. Срок выбирается в корзине.',
  subtitle = 'Через GetGems · оплата у нас'
WHERE id = '4cbeca47-b3fe-46c4-b4b0-a881423accad';

UPDATE products SET
  external_link = 'https://getgems.io/collection/buy',
  description = 'Покупка коллекционных NFT-подарков на GetGems. Цена в RUB фиксируется в момент заказа.',
  subtitle = 'Через GetGems · оплата у нас'
WHERE id = '5488014c-c7fe-4a28-b809-74d857b0a21a';
