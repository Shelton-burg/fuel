// FUEL — gym programs. Three selectable programs, all mapped to a 4-day Upper/Lower week:
// Mon = Upper A · Tue = Lower A · Wed = rest · Thu = Upper B · Fri = Lower B · Sat/Sun = rest.
// Each exercise: name, sets, reps (target text), rest = seconds between sets.
// The app adds +30 s automatically for the rest between exercises.

export const WEEKDAY_MAP = { 1: 'upperA', 2: 'lowerA', 3: null, 4: 'upperB', 5: 'lowerB', 6: null, 0: null };

export function dayIdFor(d = new Date()) {
  return WEEKDAY_MAP[d.getDay()] || null;
}

export function nextDayIdFor(d = new Date()) {
  for (let i = 1; i <= 7; i++) {
    const dd = new Date(d.getTime() + i * 864e5);
    const id = WEEKDAY_MAP[dd.getDay()];
    if (id) return { id, date: dd };
  }
  return null;
}

export const PROGRAM_LIST = [
  'strength', 'muscle', 'lean', 'speed', 'conditioning',
  'core', 'upper', 'glutes', 'home', 'beginner',
];

export const PROGRAMS = {
  /* ─────────────────────────── 1. FOUNDATION STRENGTH ─────────────────────────── */
  strength: {
    id: 'strength',
    name: 'Foundation Strength',
    tag: '5×5 · heavy compounds',
    blurb: 'Classic 5×5. Heavy weight on the big lifts, long rests, pure strength. Best when lifting for numbers is the goal.',
    restLine: '3:00 between heavy sets',
    days: {
      upperA: {
        label: 'Upper A · Push Power',
        exercises: [
          { name: 'Bench Press', sets: 5, reps: '5', rest: 180 },
          { name: 'Barbell Row', sets: 5, reps: '5', rest: 180 },
          { name: 'Standing Overhead Press', sets: 3, reps: '8', rest: 120 },
          { name: 'Lat Pulldown', sets: 3, reps: '10', rest: 120 },
          { name: 'Barbell Curl', sets: 3, reps: '10', rest: 90 },
        ],
      },
      lowerA: {
        label: 'Lower A · Squat Focus',
        exercises: [
          { name: 'Back Squat', sets: 5, reps: '5', rest: 180 },
          { name: 'Romanian Deadlift', sets: 3, reps: '8', rest: 180 },
          { name: 'Leg Press', sets: 3, reps: '10', rest: 120 },
          { name: 'Standing Calf Raise', sets: 4, reps: '12', rest: 60 },
          { name: 'Hanging Leg Raise', sets: 3, reps: '12', rest: 60 },
        ],
      },
      upperB: {
        label: 'Upper B · Pull Power',
        exercises: [
          { name: 'Overhead Press', sets: 5, reps: '5', rest: 180 },
          { name: 'Pull-Ups', sets: 4, reps: '6', rest: 180 },
          { name: 'Incline Dumbbell Press', sets: 3, reps: '8', rest: 120 },
          { name: 'Seated Cable Row', sets: 3, reps: '10', rest: 120 },
          { name: 'Face Pulls', sets: 3, reps: '15', rest: 60 },
        ],
      },
      lowerB: {
        label: 'Lower B · Deadlift Focus',
        exercises: [
          { name: 'Deadlift', sets: 4, reps: '5', rest: 210 },
          { name: 'Front Squat', sets: 3, reps: '8', rest: 180 },
          { name: 'Walking Lunges', sets: 3, reps: '10', rest: 120 },
          { name: 'Lying Leg Curl', sets: 3, reps: '12', rest: 90 },
          { name: 'Plank (seconds)', sets: 3, reps: '60', rest: 60 },
        ],
      },
    },
  },

  /* ─────────────────────────── 2. MUSCLE BUILDER ─────────────────────────── */
  muscle: {
    id: 'muscle',
    name: 'Muscle Builder',
    tag: '4-day hypertrophy · 8–12 reps',
    blurb: 'Upper/Lower hypertrophy split. Moderate reps, plenty of volume, 60–90 s rests. The classic bulking program.',
    restLine: '75–150 s between sets',
    days: {
      upperA: {
        label: 'Upper A · Chest & Back',
        exercises: [
          { name: 'Bench Press', sets: 4, reps: '8-10', rest: 90 },
          { name: 'Lat Pulldown', sets: 4, reps: '10', rest: 90 },
          { name: 'Incline Dumbbell Press', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Seated Cable Row', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Lateral Raises', sets: 3, reps: '12-15', rest: 60 },
          { name: 'Triceps Rope Pushdown', sets: 3, reps: '12', rest: 60 },
          { name: 'Barbell Curl', sets: 3, reps: '12', rest: 60 },
        ],
      },
      lowerA: {
        label: 'Lower A · Quads',
        exercises: [
          { name: 'Back Squat', sets: 4, reps: '8-10', rest: 150 },
          { name: 'Leg Press', sets: 3, reps: '10-12', rest: 90 },
          { name: 'Leg Extension', sets: 3, reps: '12', rest: 60 },
          { name: 'Lying Leg Curl', sets: 3, reps: '12', rest: 60 },
          { name: 'Seated Calf Raise', sets: 4, reps: '15', rest: 45 },
        ],
      },
      upperB: {
        label: 'Upper B · Shoulders & Arms',
        exercises: [
          { name: 'Overhead Press', sets: 4, reps: '8-10', rest: 90 },
          { name: 'Pull-Ups (assisted ok)', sets: 4, reps: '8', rest: 90 },
          { name: 'Flat Dumbbell Press', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Face Pulls', sets: 3, reps: '15', rest: 60 },
          { name: 'Hammer Curl', sets: 3, reps: '12', rest: 60 },
          { name: 'Skull Crushers', sets: 3, reps: '12', rest: 60 },
        ],
      },
      lowerB: {
        label: 'Lower B · Hams & Glutes',
        exercises: [
          { name: 'Deadlift', sets: 4, reps: '6-8', rest: 150 },
          { name: 'Hip Thrust', sets: 4, reps: '10', rest: 90 },
          { name: 'Bulgarian Split Squat', sets: 3, reps: '10', rest: 90 },
          { name: 'Seated Leg Curl', sets: 3, reps: '12', rest: 60 },
          { name: 'Standing Calf Raise', sets: 4, reps: '15', rest: 45 },
        ],
      },
    },
  },

  /* ─────────────────────────── 3. LEAN & ATHLETIC ─────────────────────────── */
  lean: {
    id: 'lean',
    name: 'Lean & Athletic',
    tag: '3-day pace · high reps · short rests',
    blurb: 'Lean-gain / cutting style. Higher reps, minimal rest, keeps the heart rate up. Add 10 min easy cardio at the end if you have fuel left.',
    restLine: '30–90 s between sets',
    days: {
      upperA: {
        label: 'Upper A · Full Upper Circuit',
        exercises: [
          { name: 'Bench Press', sets: 3, reps: '12', rest: 60 },
          { name: 'Lat Pulldown', sets: 3, reps: '12', rest: 60 },
          { name: 'Dumbbell Shoulder Press', sets: 3, reps: '12', rest: 60 },
          { name: 'Seated Cable Row', sets: 3, reps: '12', rest: 60 },
          { name: 'Lateral Raises', sets: 3, reps: '15', rest: 45 },
          { name: 'Triceps Pushdown', sets: 3, reps: '15', rest: 45 },
          { name: 'Cable Curl', sets: 3, reps: '15', rest: 45 },
        ],
      },
      lowerA: {
        label: 'Lower A · Leg Circuit',
        exercises: [
          { name: 'Goblet Squat', sets: 3, reps: '15', rest: 60 },
          { name: 'Romanian Deadlift', sets: 3, reps: '12', rest: 75 },
          { name: 'Walking Lunges', sets: 3, reps: '12', rest: 60 },
          { name: 'Lying Leg Curl', sets: 3, reps: '15', rest: 45 },
          { name: 'Standing Calf Raise', sets: 4, reps: '20', rest: 30 },
        ],
      },
      upperB: {
        label: 'Upper B · Push & Pull Mix',
        exercises: [
          { name: 'Incline Dumbbell Press', sets: 3, reps: '12', rest: 60 },
          { name: 'Assisted Pull-Ups', sets: 3, reps: '10', rest: 60 },
          { name: 'Push-Ups', sets: 3, reps: '15', rest: 45 },
          { name: 'Face Pulls', sets: 3, reps: '15', rest: 45 },
          { name: 'Rope Curl', sets: 3, reps: '15', rest: 45 },
          { name: 'Overhead Triceps Extension', sets: 3, reps: '15', rest: 45 },
        ],
      },
      lowerB: {
        label: 'Lower B · Posterior Chain',
        exercises: [
          { name: 'Trap-Bar Deadlift', sets: 3, reps: '10', rest: 90 },
          { name: 'Leg Press', sets: 3, reps: '15', rest: 60 },
          { name: 'Step-Ups', sets: 3, reps: '12', rest: 60 },
          { name: 'Glute Bridge', sets: 3, reps: '15', rest: 45 },
          { name: 'Plank (seconds)', sets: 3, reps: '45', rest: 30 },
        ],
      },
    },
  },

  /* ─────────────────────────── 4. GAIN SPEED & POWER ─────────────────────────── */
  speed: {
    id: 'speed',
    name: 'Gain Speed & Power',
    tag: 'Explosive · plyos & sprints',
    blurb: 'Built for burst, acceleration and athletic power. Low-rep explosive lifts, box jumps, med-ball throws and sprint work with full recovery.',
    restLine: '2:00–3:00 for max speed',
    days: {
      upperA: {
        label: 'Upper A · Explosive Push',
        exercises: [
          { name: 'Med-Ball Chest Pass', sets: 4, reps: '6', rest: 90 },
          { name: 'Bench Press', sets: 4, reps: '5', rest: 150 },
          { name: 'Plyo Push-Ups', sets: 3, reps: '6', rest: 90 },
          { name: 'Pull-Ups', sets: 4, reps: '6', rest: 120 },
          { name: 'Med-Ball Slam', sets: 3, reps: '8', rest: 90 },
        ],
      },
      lowerA: {
        label: 'Lower A · Sprint & Jump',
        exercises: [
          { name: 'Box Jumps', sets: 4, reps: '5', rest: 120 },
          { name: 'Trap-Bar Deadlift', sets: 4, reps: '4', rest: 180 },
          { name: 'Sled Sprint', sets: 6, reps: '20 m', rest: 120 },
          { name: 'Bulgarian Split Squat', sets: 3, reps: '6', rest: 90 },
          { name: 'Hanging Leg Raise', sets: 3, reps: '10', rest: 60 },
        ],
      },
      upperB: {
        label: 'Upper B · Rotational Power',
        exercises: [
          { name: 'Med-Ball Rotational Throw', sets: 4, reps: '6', rest: 90 },
          { name: 'Standing Overhead Press', sets: 4, reps: '5', rest: 150 },
          { name: 'Barbell Row', sets: 4, reps: '6', rest: 120 },
          { name: 'Face Pulls', sets: 3, reps: '15', rest: 60 },
          { name: 'Pallof Press', sets: 3, reps: '10', rest: 60 },
        ],
      },
      lowerB: {
        label: 'Lower B · Posterior Power',
        exercises: [
          { name: 'Broad Jumps', sets: 4, reps: '4', rest: 120 },
          { name: 'Back Squat', sets: 4, reps: '5', rest: 180 },
          { name: 'Kettlebell Swing', sets: 4, reps: '12', rest: 90 },
          { name: 'Nordic Curl', sets: 3, reps: '6', rest: 90 },
          { name: 'Assault Bike (intervals)', sets: 6, reps: '15 s all-out', rest: 60 },
        ],
      },
    },
  },

  /* ─────────────────────────── 5. ATHLETIC CONDITIONING ─────────────────────────── */
  conditioning: {
    id: 'conditioning',
    name: 'Athletic Conditioning',
    tag: 'Hybrid · strength + engine',
    blurb: 'Strength anchors paired with high-output conditioning. Kettlebells, loaded carries, rower and bike intervals to build a relentless gas tank.',
    restLine: '45–90 s work-density',
    days: {
      upperA: {
        label: 'Upper A · Push & Engine',
        exercises: [
          { name: 'Dumbbell Bench Press', sets: 4, reps: '10', rest: 75 },
          { name: 'Pull-Ups', sets: 4, reps: '8', rest: 75 },
          { name: 'Standing Overhead Press', sets: 3, reps: '10', rest: 60 },
          { name: 'Battle Ropes', sets: 4, reps: '30 s', rest: 45 },
          { name: 'Rower (intervals)', sets: 6, reps: '1 min hard', rest: 60 },
        ],
      },
      lowerA: {
        label: 'Lower A · Legs & Sled',
        exercises: [
          { name: 'Front Squat', sets: 4, reps: '8', rest: 90 },
          { name: 'Kettlebell Swing', sets: 4, reps: '15', rest: 60 },
          { name: 'Walking Lunges', sets: 3, reps: '12', rest: 60 },
          { name: 'Sled Push', sets: 5, reps: '20 m', rest: 75 },
          { name: 'Farmer\'s Carry', sets: 4, reps: '40 m', rest: 60 },
        ],
      },
      upperB: {
        label: 'Upper B · Pull & Carry',
        exercises: [
          { name: 'Barbell Row', sets: 4, reps: '10', rest: 75 },
          { name: 'Incline Dumbbell Press', sets: 3, reps: '10', rest: 75 },
          { name: 'Seated Cable Row', sets: 3, reps: '12', rest: 60 },
          { name: 'Med-Ball Slam', sets: 4, reps: '12', rest: 45 },
          { name: 'Assault Bike (intervals)', sets: 8, reps: '20 s hard', rest: 40 },
        ],
      },
      lowerB: {
        label: 'Lower B · Posterior Engine',
        exercises: [
          { name: 'Trap-Bar Deadlift', sets: 4, reps: '8', rest: 90 },
          { name: 'Goblet Squat', sets: 3, reps: '15', rest: 60 },
          { name: 'Step-Ups', sets: 3, reps: '12', rest: 60 },
          { name: 'Burpees', sets: 4, reps: '12', rest: 45 },
          { name: 'Plank (seconds)', sets: 3, reps: '60', rest: 45 },
        ],
      },
    },
  },

  /* ─────────────────────────── 6. CORE & SHRED ─────────────────────────── */
  core: {
    id: 'core',
    name: 'Core & Shred',
    tag: 'Abs + metabolic compounds',
    blurb: 'Full-body compound anchors paired with dedicated core circuits and short rests. Built for waist tightness and visible abs on a cut.',
    restLine: '45–60 s crisp pace',
    days: {
      upperA: {
        label: 'Upper A · Push + Core',
        exercises: [
          { name: 'Incline Dumbbell Press', sets: 4, reps: '10-12', rest: 60 },
          { name: 'Lat Pulldown', sets: 4, reps: '12', rest: 60 },
          { name: 'Lateral Raises', sets: 3, reps: '15', rest: 45 },
          { name: 'Hanging Leg Raise', sets: 4, reps: '12-15', rest: 45 },
          { name: 'Cable Crunch', sets: 4, reps: '15', rest: 45 },
        ],
      },
      lowerA: {
        label: 'Lower A · Legs + Stability',
        exercises: [
          { name: 'Goblet Squat', sets: 4, reps: '12-15', rest: 60 },
          { name: 'Romanian Deadlift', sets: 3, reps: '12', rest: 75 },
          { name: 'Walking Lunges', sets: 3, reps: '12', rest: 60 },
          { name: 'Ab Wheel Rollout', sets: 4, reps: '12', rest: 45 },
          { name: 'Side Plank (seconds)', sets: 3, reps: '45', rest: 30 },
        ],
      },
      upperB: {
        label: 'Upper B · Pull + Rotation',
        exercises: [
          { name: 'Seated Cable Row', sets: 4, reps: '12', rest: 60 },
          { name: 'Push-Ups', sets: 3, reps: '15-20', rest: 45 },
          { name: 'Face Pulls', sets: 3, reps: '15', rest: 45 },
          { name: 'Pallof Press', sets: 3, reps: '12', rest: 45 },
          { name: 'Russian Twist', sets: 3, reps: '20', rest: 45 },
        ],
      },
      lowerB: {
        label: 'Lower B · Posterior + Finisher',
        exercises: [
          { name: 'Trap-Bar Deadlift', sets: 3, reps: '10', rest: 75 },
          { name: 'Hip Thrust', sets: 3, reps: '12', rest: 60 },
          { name: 'Dead Bug', sets: 3, reps: '12', rest: 45 },
          { name: 'Plank (seconds)', sets: 3, reps: '60', rest: 45 },
          { name: 'Incline Treadmill Walk', sets: 1, reps: '20 min', rest: 0 },
        ],
      },
    },
  },

  /* ─────────────────────────── 7. UPPER BODY FOCUS ─────────────────────────── */
  upper: {
    id: 'upper',
    name: 'Upper Body Focus',
    tag: '3 Upper + 1 Lower · V-taper',
    blurb: 'Extra volume for chest, back, shoulders and arms across three upper days, with one solid lower day to keep your legs strong.',
    restLine: '60–90 s hypertrophy',
    days: {
      upperA: {
        label: 'Upper A · Chest & Shoulders',
        exercises: [
          { name: 'Bench Press', sets: 4, reps: '8-10', rest: 90 },
          { name: 'Incline Dumbbell Press', sets: 4, reps: '10-12', rest: 75 },
          { name: 'Cable Fly', sets: 3, reps: '12-15', rest: 60 },
          { name: 'Standing Overhead Press', sets: 3, reps: '8-10', rest: 90 },
          { name: 'Lateral Raises', sets: 4, reps: '15', rest: 45 },
        ],
      },
      lowerA: {
        label: 'Lower · Full Leg Maintenance',
        exercises: [
          { name: 'Back Squat', sets: 4, reps: '8', rest: 120 },
          { name: 'Romanian Deadlift', sets: 3, reps: '10', rest: 90 },
          { name: 'Leg Press', sets: 3, reps: '12', rest: 90 },
          { name: 'Lying Leg Curl', sets: 3, reps: '12', rest: 60 },
          { name: 'Standing Calf Raise', sets: 4, reps: '15', rest: 45 },
        ],
      },
      upperB: {
        label: 'Upper B · Back & Rear Delts',
        exercises: [
          { name: 'Pull-Ups', sets: 4, reps: '8-10', rest: 90 },
          { name: 'Barbell Row', sets: 4, reps: '8-10', rest: 90 },
          { name: 'Lat Pulldown', sets: 3, reps: '12', rest: 75 },
          { name: 'Seated Cable Row', sets: 3, reps: '12', rest: 75 },
          { name: 'Face Pulls', sets: 4, reps: '15', rest: 45 },
        ],
      },
      lowerB: {
        label: 'Upper C · Arms & Pump',
        exercises: [
          { name: 'Close-Grip Bench Press', sets: 4, reps: '8-10', rest: 90 },
          { name: 'EZ-Bar Curl', sets: 4, reps: '10-12', rest: 60 },
          { name: 'Triceps Rope Pushdown', sets: 3, reps: '12-15', rest: 60 },
          { name: 'Hammer Curl', sets: 3, reps: '12', rest: 60 },
          { name: 'Overhead Triceps Extension', sets: 3, reps: '12-15', rest: 45 },
        ],
      },
    },
  },

  /* ─────────────────────────── 8. GLUTES & LEGS FOCUS ─────────────────────────── */
  glutes: {
    id: 'glutes',
    name: 'Glutes & Legs Focus',
    tag: '3 Lower + 1 Upper · Sculpt',
    blurb: 'Three lower-body sessions targeting glutes, hamstrings and quads, balanced with one crisp upper-body session.',
    restLine: '75–120 s between sets',
    days: {
      upperA: {
        label: 'Lower A · Glute Strength',
        exercises: [
          { name: 'Hip Thrust', sets: 4, reps: '8-10', rest: 120 },
          { name: 'Romanian Deadlift', sets: 4, reps: '8-10', rest: 120 },
          { name: 'Bulgarian Split Squat', sets: 3, reps: '10', rest: 90 },
          { name: 'Cable Pull-Through', sets: 3, reps: '15', rest: 60 },
          { name: 'Standing Calf Raise', sets: 3, reps: '15', rest: 45 },
        ],
      },
      lowerA: {
        label: 'Upper · Tone & Posture',
        exercises: [
          { name: 'Incline Dumbbell Press', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Lat Pulldown', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Seated Cable Row', sets: 3, reps: '12', rest: 60 },
          { name: 'Lateral Raises', sets: 3, reps: '15', rest: 45 },
          { name: 'Face Pulls', sets: 3, reps: '15', rest: 45 },
        ],
      },
      upperB: {
        label: 'Lower B · Quads & Shape',
        exercises: [
          { name: 'Back Squat', sets: 4, reps: '8-10', rest: 120 },
          { name: 'Leg Press', sets: 4, reps: '12', rest: 90 },
          { name: 'Walking Lunges', sets: 3, reps: '12', rest: 75 },
          { name: 'Leg Extension', sets: 3, reps: '15', rest: 60 },
          { name: 'Glute Bridge', sets: 3, reps: '15', rest: 45 },
        ],
      },
      lowerB: {
        label: 'Lower C · Posterior Pump',
        exercises: [
          { name: 'Sumo Deadlift', sets: 4, reps: '6-8', rest: 150 },
          { name: 'Hip Thrust', sets: 3, reps: '12-15', rest: 90 },
          { name: 'Step-Ups', sets: 3, reps: '12', rest: 60 },
          { name: 'Seated Leg Curl', sets: 3, reps: '12-15', rest: 60 },
          { name: 'Back Extension', sets: 3, reps: '15', rest: 60 },
        ],
      },
    },
  },

  /* ─────────────────────────── 9. HOME / DUMBBELL ONLY ─────────────────────────── */
  home: {
    id: 'home',
    name: 'Home / Dumbbell Only',
    tag: 'Minimal gear · zero machines',
    blurb: 'Complete 4-day Upper/Lower plan using only a pair of dumbbells and bodyweight. Zero gym machines required.',
    restLine: '60–90 s between sets',
    days: {
      upperA: {
        label: 'Upper A · DB Push & Pull',
        exercises: [
          { name: 'Dumbbell Bench Press', sets: 4, reps: '10-12', rest: 75 },
          { name: 'One-Arm Dumbbell Row', sets: 4, reps: '10-12', rest: 75 },
          { name: 'Dumbbell Shoulder Press', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Push-Ups', sets: 3, reps: '15', rest: 60 },
          { name: 'Dumbbell Curl', sets: 3, reps: '12', rest: 60 },
        ],
      },
      lowerA: {
        label: 'Lower A · DB Squat & Hinge',
        exercises: [
          { name: 'Goblet Squat', sets: 4, reps: '12-15', rest: 75 },
          { name: 'Romanian Deadlift', sets: 4, reps: '10-12', rest: 75 },
          { name: 'Bulgarian Split Squat', sets: 3, reps: '10', rest: 75 },
          { name: 'Glute Bridge', sets: 3, reps: '15', rest: 45 },
          { name: 'Plank (seconds)', sets: 3, reps: '60', rest: 45 },
        ],
      },
      upperB: {
        label: 'Upper B · DB Shoulders & Arms',
        exercises: [
          { name: 'Incline Dumbbell Press', sets: 4, reps: '10-12', rest: 75 },
          { name: 'One-Arm Dumbbell Row', sets: 4, reps: '12', rest: 75 },
          { name: 'Lateral Raises', sets: 4, reps: '15', rest: 45 },
          { name: 'Hammer Curl', sets: 3, reps: '12', rest: 60 },
          { name: 'Dumbbell Kickbacks', sets: 3, reps: '12-15', rest: 45 },
        ],
      },
      lowerB: {
        label: 'Lower B · DB Lunges & Core',
        exercises: [
          { name: 'Walking Lunges', sets: 4, reps: '12', rest: 75 },
          { name: 'Stiff-Leg Deadlift', sets: 3, reps: '12', rest: 75 },
          { name: 'Step-Ups', sets: 3, reps: '12', rest: 60 },
          { name: 'Standing Calf Raise', sets: 4, reps: '15', rest: 45 },
          { name: 'Dead Bug', sets: 3, reps: '12', rest: 45 },
        ],
      },
    },
  },

  /* ─────────────────────────── 10. BEGINNER FOUNDATIONS ─────────────────────────── */
  beginner: {
    id: 'beginner',
    name: 'Beginner Foundations',
    tag: '3 sets · joint-friendly starter',
    blurb: 'Simple, approachable 4-day plan with 3 sets per move and clear targets. Perfect for building the gym habit safely.',
    restLine: '60–90 s comfortable rest',
    days: {
      upperA: {
        label: 'Upper A · Basics',
        exercises: [
          { name: 'Machine Chest Press', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Lat Pulldown', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Dumbbell Shoulder Press', sets: 3, reps: '10', rest: 75 },
          { name: 'Dumbbell Curl', sets: 3, reps: '12', rest: 60 },
          { name: 'Triceps Pushdown', sets: 3, reps: '12', rest: 60 },
        ],
      },
      lowerA: {
        label: 'Lower A · Basics',
        exercises: [
          { name: 'Goblet Squat', sets: 3, reps: '10-12', rest: 90 },
          { name: 'Leg Press', sets: 3, reps: '12', rest: 90 },
          { name: 'Seated Leg Curl', sets: 3, reps: '12', rest: 60 },
          { name: 'Standing Calf Raise', sets: 3, reps: '15', rest: 45 },
          { name: 'Plank (seconds)', sets: 3, reps: '40', rest: 45 },
        ],
      },
      upperB: {
        label: 'Upper B · Posture & Pull',
        exercises: [
          { name: 'Incline Dumbbell Press', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Seated Cable Row', sets: 3, reps: '10-12', rest: 75 },
          { name: 'Lateral Raises', sets: 3, reps: '12-15', rest: 60 },
          { name: 'Face Pulls', sets: 3, reps: '15', rest: 45 },
          { name: 'Hammer Curl', sets: 3, reps: '12', rest: 60 },
        ],
      },
      lowerB: {
        label: 'Lower B · Hinge & Core',
        exercises: [
          { name: 'Romanian Deadlift', sets: 3, reps: '10', rest: 90 },
          { name: 'Walking Lunges', sets: 3, reps: '10', rest: 75 },
          { name: 'Glute Bridge', sets: 3, reps: '15', rest: 45 },
          { name: 'Back Extension', sets: 3, reps: '12', rest: 60 },
          { name: 'Dead Bug', sets: 3, reps: '10', rest: 45 },
        ],
      },
    },
  },
};

/* ─────────────────────────── exercise library (swap / add) ───────────────────────────
   Curated list used by the swap sheet: name, muscle group, sensible default scheme.
   Every exercise used by the three programs is in here so "same muscle group" works
   from any starting point. Numbers are starting points for ADDED exercises only —
   a SWAP keeps the scheme the exercise it replaces already had. */
export const EX_LIB = [
  /* chest */
  { name: 'Bench Press', group: 'Chest', sets: 4, reps: '8-10', rest: 90 },
  { name: 'Incline Bench Press', group: 'Chest', sets: 4, reps: '8-10', rest: 90 },
  { name: 'Decline Bench Press', group: 'Chest', sets: 3, reps: '10', rest: 90 },
  { name: 'Dumbbell Bench Press', group: 'Chest', sets: 4, reps: '10', rest: 75 },
  { name: 'Incline Dumbbell Press', group: 'Chest', sets: 3, reps: '10-12', rest: 75 },
  { name: 'Flat Dumbbell Press', group: 'Chest', sets: 3, reps: '10-12', rest: 75 },
  { name: 'Dumbbell Fly', group: 'Chest', sets: 3, reps: '12', rest: 60 },
  { name: 'Cable Fly', group: 'Chest', sets: 3, reps: '12-15', rest: 60 },
  { name: 'Pec Deck', group: 'Chest', sets: 3, reps: '12', rest: 60 },
  { name: 'Machine Chest Press', group: 'Chest', sets: 3, reps: '10-12', rest: 75 },
  { name: 'Push-Ups', group: 'Chest', sets: 3, reps: '15', rest: 45 },
  { name: 'Chest Dips', group: 'Chest', sets: 3, reps: '8-10', rest: 75 },
  /* back */
  { name: 'Barbell Row', group: 'Back', sets: 4, reps: '8-10', rest: 90 },
  { name: 'Pendlay Row', group: 'Back', sets: 4, reps: '5', rest: 120 },
  { name: 'Dumbbell Row', group: 'Back', sets: 3, reps: '10', rest: 75 },
  { name: 'Chest-Supported Row', group: 'Back', sets: 3, reps: '10-12', rest: 75 },
  { name: 'Seated Cable Row', group: 'Back', sets: 3, reps: '10-12', rest: 75 },
  { name: 'Machine Row', group: 'Back', sets: 3, reps: '10-12', rest: 75 },
  { name: 'T-Bar Row', group: 'Back', sets: 3, reps: '8-10', rest: 90 },
  { name: 'Lat Pulldown', group: 'Back', sets: 4, reps: '10', rest: 90 },
  { name: 'Straight-Arm Pulldown', group: 'Back', sets: 3, reps: '12-15', rest: 60 },
  { name: 'Pull-Ups', group: 'Back', sets: 4, reps: '6', rest: 120 },
  { name: 'Pull-Ups (assisted ok)', group: 'Back', sets: 4, reps: '8', rest: 90 },
  { name: 'Assisted Pull-Ups', group: 'Back', sets: 3, reps: '10', rest: 60 },
  { name: 'Chin-Ups', group: 'Back', sets: 3, reps: '6-8', rest: 90 },
  { name: 'Rack Pull', group: 'Back', sets: 3, reps: '6', rest: 150 },
  /* shoulders */
  { name: 'Overhead Press', group: 'Shoulders', sets: 4, reps: '8-10', rest: 90 },
  { name: 'Standing Overhead Press', group: 'Shoulders', sets: 3, reps: '8', rest: 120 },
  { name: 'Dumbbell Shoulder Press', group: 'Shoulders', sets: 3, reps: '10-12', rest: 60 },
  { name: 'Machine Shoulder Press', group: 'Shoulders', sets: 3, reps: '10-12', rest: 75 },
  { name: 'Arnold Press', group: 'Shoulders', sets: 3, reps: '10-12', rest: 60 },
  { name: 'Push Press', group: 'Shoulders', sets: 3, reps: '5', rest: 120 },
  { name: 'Lateral Raises', group: 'Shoulders', sets: 3, reps: '12-15', rest: 60 },
  { name: 'Cable Lateral Raise', group: 'Shoulders', sets: 3, reps: '12-15', rest: 45 },
  { name: 'Rear Delt Fly', group: 'Shoulders', sets: 3, reps: '12-15', rest: 45 },
  { name: 'Face Pulls', group: 'Shoulders', sets: 3, reps: '15', rest: 60 },
  { name: 'Upright Row', group: 'Shoulders', sets: 3, reps: '12', rest: 60 },
  { name: 'Shrugs', group: 'Shoulders', sets: 3, reps: '12-15', rest: 60 },
  /* biceps */
  { name: 'Barbell Curl', group: 'Biceps', sets: 3, reps: '10-12', rest: 60 },
  { name: 'EZ-Bar Curl', group: 'Biceps', sets: 3, reps: '10-12', rest: 60 },
  { name: 'Dumbbell Curl', group: 'Biceps', sets: 3, reps: '10-12', rest: 60 },
  { name: 'Hammer Curl', group: 'Biceps', sets: 3, reps: '12', rest: 60 },
  { name: 'Incline Dumbbell Curl', group: 'Biceps', sets: 3, reps: '10-12', rest: 60 },
  { name: 'Cable Curl', group: 'Biceps', sets: 3, reps: '12-15', rest: 45 },
  { name: 'Rope Curl', group: 'Biceps', sets: 3, reps: '15', rest: 45 },
  { name: 'Preacher Curl', group: 'Biceps', sets: 3, reps: '10-12', rest: 60 },
  /* triceps */
  { name: 'Close-Grip Bench Press', group: 'Triceps', sets: 3, reps: '8-10', rest: 90 },
  { name: 'Skull Crushers', group: 'Triceps', sets: 3, reps: '10-12', rest: 60 },
  { name: 'Triceps Rope Pushdown', group: 'Triceps', sets: 3, reps: '12', rest: 60 },
  { name: 'Triceps Pushdown', group: 'Triceps', sets: 3, reps: '12-15', rest: 45 },
  { name: 'Overhead Triceps Extension', group: 'Triceps', sets: 3, reps: '12-15', rest: 45 },
  { name: 'Dumbbell Kickbacks', group: 'Triceps', sets: 3, reps: '12-15', rest: 45 },
  { name: 'Triceps Dips', group: 'Triceps', sets: 3, reps: '10', rest: 60 },
  /* quads */
  { name: 'Back Squat', group: 'Quads', sets: 4, reps: '8-10', rest: 150 },
  { name: 'Front Squat', group: 'Quads', sets: 3, reps: '8', rest: 150 },
  { name: 'Hack Squat', group: 'Quads', sets: 3, reps: '10-12', rest: 120 },
  { name: 'Smith Machine Squat', group: 'Quads', sets: 3, reps: '10-12', rest: 120 },
  { name: 'Pause Squat', group: 'Quads', sets: 3, reps: '5', rest: 150 },
  { name: 'Leg Press', group: 'Quads', sets: 3, reps: '10-12', rest: 90 },
  { name: 'Leg Extension', group: 'Quads', sets: 3, reps: '12', rest: 60 },
  { name: 'Goblet Squat', group: 'Quads', sets: 3, reps: '15', rest: 60 },
  { name: 'Bulgarian Split Squat', group: 'Quads', sets: 3, reps: '10', rest: 90 },
  { name: 'Walking Lunges', group: 'Quads', sets: 3, reps: '10', rest: 90 },
  { name: 'Step-Ups', group: 'Quads', sets: 3, reps: '12', rest: 60 },
  /* hams & glutes */
  { name: 'Deadlift', group: 'Hams & Glutes', sets: 4, reps: '6-8', rest: 150 },
  { name: 'Sumo Deadlift', group: 'Hams & Glutes', sets: 4, reps: '5', rest: 180 },
  { name: 'Trap-Bar Deadlift', group: 'Hams & Glutes', sets: 3, reps: '10', rest: 90 },
  { name: 'Romanian Deadlift', group: 'Hams & Glutes', sets: 3, reps: '8-10', rest: 120 },
  { name: 'Stiff-Leg Deadlift', group: 'Hams & Glutes', sets: 3, reps: '10', rest: 120 },
  { name: 'Hip Thrust', group: 'Hams & Glutes', sets: 4, reps: '10', rest: 90 },
  { name: 'Glute Bridge', group: 'Hams & Glutes', sets: 3, reps: '15', rest: 45 },
  { name: 'Lying Leg Curl', group: 'Hams & Glutes', sets: 3, reps: '12', rest: 60 },
  { name: 'Seated Leg Curl', group: 'Hams & Glutes', sets: 3, reps: '12', rest: 60 },
  { name: 'Nordic Curl', group: 'Hams & Glutes', sets: 3, reps: '6-8', rest: 90 },
  { name: 'Good Morning', group: 'Hams & Glutes', sets: 3, reps: '10', rest: 90 },
  { name: 'Cable Pull-Through', group: 'Hams & Glutes', sets: 3, reps: '15', rest: 45 },
  { name: 'Back Extension', group: 'Hams & Glutes', sets: 3, reps: '12-15', rest: 60 },
  /* calves */
  { name: 'Standing Calf Raise', group: 'Calves', sets: 4, reps: '15', rest: 45 },
  { name: 'Seated Calf Raise', group: 'Calves', sets: 4, reps: '15', rest: 45 },
  { name: 'Leg Press Calf Raise', group: 'Calves', sets: 4, reps: '15-20', rest: 45 },
  /* core */
  { name: 'Plank (seconds)', group: 'Core', sets: 3, reps: '60', rest: 60 },
  { name: 'Side Plank (seconds)', group: 'Core', sets: 3, reps: '40', rest: 45 },
  { name: 'Hanging Leg Raise', group: 'Core', sets: 3, reps: '12', rest: 60 },
  { name: 'Cable Crunch', group: 'Core', sets: 3, reps: '15', rest: 45 },
  { name: 'Ab Wheel Rollout', group: 'Core', sets: 3, reps: '10-12', rest: 60 },
  { name: 'Russian Twist', group: 'Core', sets: 3, reps: '20', rest: 45 },
  { name: 'Dead Bug', group: 'Core', sets: 3, reps: '10', rest: 45 },
  { name: 'Pallof Press', group: 'Core', sets: 3, reps: '10', rest: 45 },
  /* conditioning & power */
  { name: 'Rower (intervals)', group: 'Cardio', sets: 6, reps: '1 min hard', rest: 60 },
  { name: 'Assault Bike (intervals)', group: 'Cardio', sets: 8, reps: '20 s hard', rest: 40 },
  { name: 'Incline Treadmill Walk', group: 'Cardio', sets: 1, reps: '20 min', rest: 0 },
  { name: 'Sled Push', group: 'Cardio', sets: 4, reps: '20 m', rest: 90 },
  { name: 'Sled Sprint', group: 'Cardio', sets: 6, reps: '20 m', rest: 120 },
  { name: 'Box Jumps', group: 'Quads', sets: 4, reps: '5', rest: 120 },
  { name: 'Broad Jumps', group: 'Quads', sets: 4, reps: '4', rest: 120 },
  { name: 'Kettlebell Swing', group: 'Hams & Glutes', sets: 4, reps: '15', rest: 60 },
  { name: 'Med-Ball Chest Pass', group: 'Chest', sets: 4, reps: '6', rest: 90 },
  { name: 'Plyo Push-Ups', group: 'Chest', sets: 3, reps: '6', rest: 90 },
  { name: 'Med-Ball Slam', group: 'Cardio', sets: 4, reps: '10', rest: 60 },
  { name: 'Med-Ball Rotational Throw', group: 'Core', sets: 4, reps: '6', rest: 90 },
  { name: 'Battle Ropes', group: 'Cardio', sets: 4, reps: '30 s', rest: 45 },
  { name: 'Farmer\'s Carry', group: 'Cardio', sets: 4, reps: '40 m', rest: 60 },
  { name: 'Burpees', group: 'Cardio', sets: 4, reps: '12', rest: 45 },
];

const libKey = (n) => String(n || '').toLowerCase().trim();

/** muscle group for an exercise name, or null when it is a custom name */
export function exGroup(name) {
  const hit = EX_LIB.find((x) => libKey(x.name) === libKey(name));
  return hit ? hit.group : null;
}

/** library entry for a name, or null */
export function exMeta(name) {
  return EX_LIB.find((x) => libKey(x.name) === libKey(name)) || null;
}

/** library entries in a group, alphabetically, excluding the given names */
export function exInGroup(group, exclude = []) {
  const ex = new Set(exclude.map(libKey));
  return EX_LIB.filter((x) => x.group === group && !ex.has(libKey(x.name))).slice().sort((a, b) => a.name.localeCompare(b.name));
}

