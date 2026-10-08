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

export const PROGRAM_LIST = ['strength', 'muscle', 'lean'];

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
};
