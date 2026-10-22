-- ============================================================================
-- CoreMotors — Seed opcional
-- Migra o inventário de exemplo (antigo `data/vehicles.ts`) para a base de dados.
-- As imagens apontam para o Unsplash (URLs absolutos → guardados tal como estão
-- em `car_media.storage_path`; o site resolve-os diretamente). Substitua por
-- uploads reais no backoffice quando quiser.
--
-- Correr no SQL Editor do Supabase DEPOIS de aplicar `migrations/0001_init.sql`.
-- Idempotente: faz upsert por `slug`.
-- ============================================================================

-- ---- Viaturas --------------------------------------------------------------
insert into public.cars
  (slug, make, model, variant, year, price, mileage, fuel, transmission, body,
   power, displacement, color, doors, seats, featured, status, tagline,
   description, extras, location, highlights, published_at)
values
  ('bmw-m4-competition-2023', 'BMW', 'M4 Competition', 'xDrive', 2023, 92500, 18400,
   'Gasolina', 'Automática', 'Coupé', 510, 2993, 'Cinzento Frozen', 2, 4, true,
   'published', 'Precisão alemã, sem compromissos.',
   'Um M4 Competition xDrive em estado impecável, com histórico completo em concessionário. Tração integral M xDrive, diferencial ativo e pacote M Carbon. Uma máquina de condução para quem não aceita meios-termos.',
   array['Pacote M Carbon','Diferencial ativo M','Bancos desportivos M','Head-up display','Harman Kardon'],
   'Lisboa',
   '[{"label":"Potência","value":"510 cv"},{"label":"0–100 km/h","value":"3,5 s"},{"label":"Tração","value":"M xDrive integral"},{"label":"Caixa","value":"M Steptronic 8 vel."},{"label":"Emissões","value":"234 g/km CO₂"}]'::jsonb,
   now()),

  ('audi-rs6-avant-2022', 'Audi', 'RS6 Avant', 'quattro', 2022, 118900, 31200,
   'Híbrido', 'Automática', 'Carrinha', 600, 3996, 'Preto Mythos', 5, 5, true,
   'published', 'A carrinha que não pede desculpa.',
   'V8 biturbo de 600 cv com micro-hibridação mild-hybrid, suspensão pneumática RS e travões cerâmicos. Espaço de família, alma de desportivo. Nacional, IVA dedutível.',
   array['Travões cerâmicos','Suspensão pneumática RS','IVA dedutível','Matrix LED','Teto panorâmico'],
   'Lisboa',
   '[{"label":"Potência","value":"600 cv"},{"label":"0–100 km/h","value":"3,6 s"},{"label":"Tração","value":"quattro permanente"},{"label":"Caixa","value":"tiptronic 8 vel."},{"label":"Bagageira","value":"565 L"}]'::jsonb,
   now()),

  ('porsche-taycan-4s-2023', 'Porsche', 'Taycan 4S', null, 2023, 104500, 12750,
   'Elétrico', 'Automática', 'Berlina', 530, 0, 'Azul Gentian', 4, 4, true,
   'published', 'Silêncio a 100% de intensidade.',
   'Taycan 4S com bateria Performance Plus, arquitetura de 800 V para carregamentos ultra-rápidos e eixo traseiro direcional. O futuro Porsche, disponível hoje.',
   array['Bateria Performance Plus','Eixo traseiro direcional','Bomba de calor','Carregamento 800V'],
   'Lisboa',
   '[{"label":"Potência","value":"530 cv (overboost)"},{"label":"Autonomia","value":"463 km (WLTP)"},{"label":"Arquitetura","value":"800 V"},{"label":"Carga DC","value":"até 270 kW"},{"label":"0–100 km/h","value":"4,0 s"}]'::jsonb,
   now()),

  ('mercedes-benz-c220d-2021', 'Mercedes-Benz', 'C 220 d', 'AMG Line', 2021, 46900, 54300,
   'Diesel', 'Automática', 'Berlina', 200, 1993, 'Prata Iridium', 4, 5, false,
   'published', 'Elegância diária, eficiência real.',
   'C 220 d AMG Line com pacote Premium, MBUX e faróis Digital Light. O equilíbrio perfeito entre conforto, consumos e presença. Revisões em concessionário.',
   array['Pacote Premium','MBUX','Digital Light','Bancos em pele'],
   'Lisboa',
   '[{"label":"Potência","value":"200 cv"},{"label":"Binário","value":"440 Nm"},{"label":"Consumo","value":"4,9 L/100 km"},{"label":"Caixa","value":"9G-TRONIC"},{"label":"Emissões","value":"129 g/km CO₂"}]'::jsonb,
   now()),

  ('volkswagen-golf-gti-2022', 'Volkswagen', 'Golf GTI', null, 2022, 38500, 27800,
   'Gasolina', 'Automática', 'Citadino', 245, 1984, 'Vermelho Kings', 5, 5, false,
   'published', 'O hot-hatch de referência.',
   'Golf GTI de oitava geração com diferencial VAQ, cockpit digital e caixa DSG. O clássico moderno que continua a definir a categoria. Garantia de fábrica válida.',
   array['Diferencial VAQ','Digital Cockpit Pro','Caixa DSG','Garantia de fábrica'],
   'Lisboa',
   '[{"label":"Potência","value":"245 cv"},{"label":"0–100 km/h","value":"6,3 s"},{"label":"Caixa","value":"DSG 7 vel."},{"label":"Diferencial","value":"VAQ dianteiro"},{"label":"Consumo","value":"7,2 L/100 km"}]'::jsonb,
   now()),

  ('tesla-model-3-performance-2023', 'Tesla', 'Model 3 Performance', null, 2023, 49900, 9800,
   'Elétrico', 'Automática', 'Berlina', 513, 0, 'Branco Pérola', 4, 5, false,
   'published', 'Aceleração instantânea, custos mínimos.',
   'Model 3 Performance com tração integral dual-motor, suspensão desportiva e travões atualizados. Acesso à rede Supercharger e Autopilot incluído. Como nova.',
   array['Dual-motor AWD','Autopilot','Acesso Supercharger','Suspensão desportiva'],
   'Lisboa',
   '[{"label":"Potência","value":"513 cv"},{"label":"0–100 km/h","value":"3,3 s"},{"label":"Autonomia","value":"547 km (WLTP)"},{"label":"Tração","value":"AWD dual-motor"},{"label":"Carga DC","value":"até 250 kW"}]'::jsonb,
   now())
on conflict (slug) do update set
  make = excluded.make, model = excluded.model, status = excluded.status;

-- ---- Media (fotos) ---------------------------------------------------------
-- Limpa media anterior destas viaturas (para o seed ser idempotente).
delete from public.car_media
where car_id in (select id from public.cars where slug in (
  'bmw-m4-competition-2023','audi-rs6-avant-2022','porsche-taycan-4s-2023',
  'mercedes-benz-c220d-2021','volkswagen-golf-gti-2022','tesla-model-3-performance-2023'
));

insert into public.car_media (car_id, kind, storage_path, alt, position, is_cover, width, height)
select c.id, 'image', m.url, m.alt, m.pos, m.pos = 0, 1600, 1067
from public.cars c
join (values
  ('bmw-m4-competition-2023', 0, 'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1600&q=80', 'BMW M4 Competition cinzento visto de três quartos frontal'),
  ('bmw-m4-competition-2023', 1, 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1600&q=80', 'Traseira do BMW M4 Competition'),
  ('bmw-m4-competition-2023', 2, 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80', 'Perfil lateral do BMW M4 em estrada'),
  ('audi-rs6-avant-2022', 0, 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1600&q=80', 'Audi RS6 Avant preta de três quartos'),
  ('audi-rs6-avant-2022', 1, 'https://images.unsplash.com/photo-1614200187524-dc4b892acf16?auto=format&fit=crop&w=1600&q=80', 'Detalhe da jante do Audi RS6'),
  ('audi-rs6-avant-2022', 2, 'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?auto=format&fit=crop&w=1600&q=80', 'Audi RS6 Avant em ambiente urbano'),
  ('porsche-taycan-4s-2023', 0, 'https://images.unsplash.com/photo-1619767886558-efdc259cde1a?auto=format&fit=crop&w=1600&q=80', 'Porsche Taycan azul de três quartos frontal'),
  ('porsche-taycan-4s-2023', 1, 'https://images.unsplash.com/photo-1614026480209-cc6c8f2c2e5e?auto=format&fit=crop&w=1600&q=80', 'Interior do Porsche Taycan'),
  ('porsche-taycan-4s-2023', 2, 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=1600&q=80', 'Porsche Taycan em movimento'),
  ('mercedes-benz-c220d-2021', 0, 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1600&q=80', 'Mercedes-Benz Classe C prateado de três quartos'),
  ('mercedes-benz-c220d-2021', 1, 'https://images.unsplash.com/photo-1617531653332-bd46c24f2068?auto=format&fit=crop&w=1600&q=80', 'Interior do Mercedes Classe C'),
  ('volkswagen-golf-gti-2022', 0, 'https://images.unsplash.com/photo-1594502184342-2e12f877aa73?auto=format&fit=crop&w=1600&q=80', 'Volkswagen Golf GTI vermelho de três quartos'),
  ('volkswagen-golf-gti-2022', 1, 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1600&q=80', 'Perfil do Volkswagen Golf GTI'),
  ('tesla-model-3-performance-2023', 0, 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1600&q=80', 'Tesla Model 3 branco de três quartos frontal'),
  ('tesla-model-3-performance-2023', 1, 'https://images.unsplash.com/photo-1554744512-d6c603f27c54?auto=format&fit=crop&w=1600&q=80', 'Interior minimalista do Tesla Model 3')
) as m(slug, pos, url, alt) on m.slug = c.slug;
