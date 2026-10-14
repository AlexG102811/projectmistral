// seed.js — inserts the five quizzes, their questions, and the first admin account.
// Admin credentials come from environment variables (spec §4): ADMIN_USERNAME / ADMIN_PASSWORD.
// Run: npm run seed
const crypto = require('crypto');
const { pool, initSchema } = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// q(text, a, b, c, d, correct)
const q = (question_text, a, b, c, d, correct_choice) =>
  ({ question_text, choice_a: a, choice_b: b, choice_c: c, choice_d: d, correct_choice });

const QUIZZES = [
  {
    title: 'Warm-Up Wonders', topic: 'General knowledge', difficulty: 'easy', time_limit_seconds: null,
    questions: [
      q('How many continents are there on Earth?', '5', '6', '7', '8', 'c'),
      q('What color do you get when you mix blue and yellow paint?', 'Green', 'Purple', 'Orange', 'Brown', 'a'),
      q('Which animal is known as the "King of the Jungle"?', 'Tiger', 'Lion', 'Elephant', 'Giraffe', 'b'),
      q('How many sides does a triangle have?', '2', '3', '4', '5', 'b'),
      q('What is the largest planet in our solar system?', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'c'),
      q('Which fruit is famous for keeping the doctor away?', 'Banana', 'Orange', 'Apple', 'Grape', 'c'),
      q('What do bees collect to make honey?', 'Water', 'Nectar', 'Leaves', 'Seeds', 'b'),
      q('How many legs does a spider have?', '6', '8', '10', '12', 'b'),
      q('Which season comes after winter?', 'Autumn', 'Summer', 'Spring', 'Monsoon', 'c'),
      q('What is the name of Earth\u2019s natural satellite?', 'Titan', 'Europa', 'The Moon', 'Phobos', 'c'),
    ],
  },
  {
    title: 'Everyday Science', topic: 'Science basics', difficulty: 'easy_medium', time_limit_seconds: null,
    questions: [
      q('What gas do plants absorb from the air for photosynthesis?', 'Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen', 'c'),
      q('At what temperature does water boil at sea level (Celsius)?', '50\u00b0C', '75\u00b0C', '100\u00b0C', '150\u00b0C', 'c'),
      q('What is the chemical symbol for gold?', 'Go', 'Gd', 'Ag', 'Au', 'd'),
      q('Which planet is closest to the Sun?', 'Venus', 'Mercury', 'Earth', 'Mars', 'b'),
      q('What force pulls objects toward Earth\u2019s center?', 'Magnetism', 'Friction', 'Gravity', 'Tension', 'c'),
      q('Which body organ pumps blood through the body?', 'Liver', 'Lung', 'Heart', 'Kidney', 'c'),
      q('What is H2O commonly known as?', 'Salt', 'Water', 'Oxygen', 'Hydrogen peroxide', 'b'),
      q('Sound travels fastest through which medium?', 'Vacuum', 'Air', 'Water', 'Steel', 'd'),
      q('Which part of the plant absorbs water from the soil?', 'Leaf', 'Stem', 'Flower', 'Roots', 'd'),
      q('What instrument measures temperature?', 'Barometer', 'Thermometer', 'Altimeter', 'Odometer', 'b'),
    ],
  },
  {
    title: 'World Tour', topic: 'Geography', difficulty: 'medium', time_limit_seconds: 600,
    questions: [
      q('What is the capital of Australia?', 'Sydney', 'Melbourne', 'Canberra', 'Perth', 'c'),
      q('Which is the longest river in the world?', 'Amazon', 'Nile', 'Yangtze', 'Mississippi', 'b'),
      q('Mount Everest lies on the border of Nepal and which country?', 'India', 'China', 'Bhutan', 'Pakistan', 'b'),
      q('Which desert is the largest hot desert in the world?', 'Gobi', 'Kalahari', 'Sahara', 'Mojave', 'c'),
      q('In which country would you find the city of Marrakesh?', 'Egypt', 'Tunisia', 'Morocco', 'Algeria', 'c'),
      q('What is the smallest country in the world by area?', 'Monaco', 'Nauru', 'San Marino', 'Vatican City', 'd'),
      q('Which ocean lies between Africa and Australia?', 'Atlantic', 'Pacific', 'Indian', 'Southern', 'c'),
      q('Which country has the most natural lakes?', 'Russia', 'Canada', 'Finland', 'Brazil', 'b'),
      q('The Andes mountains run mainly along which coast?', 'Eastern South America', 'Western South America', 'Central Africa', 'Eastern Asia', 'b'),
      q('What is the capital of Canada?', 'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'c'),
    ],
  },
  {
    title: 'History Highlights', topic: 'History', difficulty: 'hard', time_limit_seconds: 720,
    questions: [
      q('In which year did World War I begin?', '1905', '1912', '1914', '1918', 'c'),
      q('Who was the first President of the United States?', 'Jefferson', 'Adams', 'Washington', 'Madison', 'c'),
      q('The Berlin Wall fell in which year?', '1987', '1989', '1991', '1993', 'b'),
      q('Which ancient civilization built Machu Picchu?', 'Maya', 'Aztec', 'Inca', 'Olmec', 'c'),
      q('Who wrote the 95 Theses, starting the Reformation?', 'Calvin', 'Luther', 'Zwingli', 'Knox', 'b'),
      q('The Rosetta Stone helped scholars decipher which writing system?', 'Cuneiform', 'Linear B', 'Hieroglyphics', 'Runes', 'c'),
      q('Which empire was ruled by Genghis Khan?', 'Ottoman', 'Mongol', 'Persian', 'Byzantine', 'b'),
      q('The Magna Carta was signed in which century?', '11th', '12th', '13th', '14th', 'c'),
      q('Who was the last pharaoh of ancient Egypt?', 'Cleopatra VII', 'Ramses II', 'Hatshepsut', 'Tutankhamun', 'a'),
      q('Which country gifted the Statue of Liberty to the USA?', 'Britain', 'France', 'Spain', 'Italy', 'b'),
    ],
  },
  {
    title: 'Mind Benders', topic: 'Expert mix', difficulty: 'expert', time_limit_seconds: 900,
    questions: [
      q('What is the only number whose spelling (in English) has letters in alphabetical order?', 'One', 'Forty', 'Ten', 'Zero', 'b'),
      q('Which element has the highest melting point?', 'Tungsten', 'Carbon', 'Osmium', 'Platinum', 'b'),
      q('In computing, what does the acronym "RAM" stand for?', 'Rapid Access Module', 'Random Access Memory', 'Read And Modify', 'Runtime Allocation Map', 'b'),
      q('Who painted "The Persistence of Memory" with melting clocks?', 'Picasso', 'Matisse', 'Dal\u00ed', 'Mir\u00f3', 'c'),
      q('What is the SI unit of electrical inductance?', 'Tesla', 'Weber', 'Henry', 'Farad', 'c'),
      q('Which Shakespeare play features the character Prospero?', 'The Tempest', 'Twelfth Night', 'As You Like It', 'Cymbeline', 'a'),
      q('What is the hardest known natural material?', 'Quartz', 'Diamond', 'Corundum', 'Topaz', 'b'),
      q('Which mathematician proved Fermat\u2019s Last Theorem?', 'Andrew Wiles', 'Grigori Perelman', 'Terence Tao', 'John Nash', 'a'),
      q('The Krebs cycle is also known as the what?', 'Electron transport chain', 'Citric acid cycle', 'Calvin cycle', 'Urea cycle', 'b'),
      q('What is the smallest prime number?', '0', '1', '2', '3', 'c'),
    ],
  },
];

async function seed() {
  await initSchema();

  // quizzes + questions (idempotent: skip quizzes whose title already exists)
  for (const z of QUIZZES) {
    const exists = await pool.query('SELECT id FROM quizzes WHERE title=$1', [z.title]);
    let quizId;
    if (exists.rows.length) {
      quizId = exists.rows[0].id;
      console.log(`Quiz "${z.title}" already exists (id ${quizId}) \u2014 skipped`);
    } else {
      const ins = await pool.query(
        `INSERT INTO quizzes (title,topic,difficulty,is_published,time_limit_seconds)
         VALUES ($1,$2,$3,TRUE,$4) RETURNING id`,
        [z.title, z.topic, z.difficulty, z.time_limit_seconds]);
      quizId = ins.rows[0].id;
      console.log(`Created quiz "${z.title}" (id ${quizId})`);
    }
    for (let i = 0; i < z.questions.length; i++) {
      const p = z.questions[i];
      const dupe = await pool.query('SELECT id FROM questions WHERE quiz_id=$1 AND question_text=$2', [quizId, p.question_text]);
      if (dupe.rows.length) continue;
      await pool.query(
        `INSERT INTO questions (quiz_id,question_text,choice_a,choice_b,choice_c,choice_d,correct_choice,position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [quizId, p.question_text, p.choice_a, p.choice_b, p.choice_c, p.choice_d, p.correct_choice, i + 1]);
    }
    console.log(`  \u2192 ${z.questions.length} questions ensured`);
  }

  // first admin account from env vars
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminExists = await pool.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1)', [username]);
  if (adminExists.rows.length) {
    console.log(`Admin "${username}" already exists \u2014 skipped`);
  } else {
    await pool.query(
      `INSERT INTO users (username,email,password_hash,role) VALUES ($1,$2,$3,'admin')`,
      [username, email, hashPassword(password)]);
    console.log(`Created admin "${username}" (password from ADMIN_PASSWORD env var)`);
  }
  console.log('Seed complete.');
  await pool.end();
}

seed().catch(e => { console.error('Seed failed:', e); process.exit(1); });
