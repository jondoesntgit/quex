import { ACTIONS, BUILDINGS, HABIT_PRESETS, MAX_HABIT_SLOTS, PERFECT_DAYS_PER_SLOT, SIZE_POINTS } from '../game/data'
import { SEASON_WEEKS } from '../game/calendar'
import { ROLE_INFO } from './helpers'

/** The player's guide. Numbers come from the game's own data so the guide
 *  stays true when the rules change. */
export function Help({ onClose }: { onClose: () => void }) {
  const actions = Object.values(ACTIONS)
  const bySize = (size: 'small' | 'medium' | 'big') => actions.filter((a) => a.size === size)
  const roleBuildings = (role: string) => Object.values(BUILDINGS).filter((b) => b.role === role).map((b) => b.name).join(', ')

  return (
    <div className="modal account" onClick={onClose}>
      <div className="card help" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>How to play</h2>
          <button className="btn ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        <p>
          Quex turns your real to-do list into a little village. Finish today's tasks, spend the actions they earn on
          the map, and get back to life. A few minutes a day is plenty.
        </p>

        <details open>
          <summary>Your day: the 1-2-3 list</summary>
          <p>Each day you get six task slots in the <b>Today</b> tab: one big, two medium and three small.</p>
          <ul>
            <li><b>Big</b> ({SIZE_POINTS.big} pts): the one thing that matters most today.</li>
            <li><b>Medium</b> ({SIZE_POINTS.medium} pts each): two solid jobs.</li>
            <li><b>Small</b> ({SIZE_POINTS.small} pts each): three quick wins.</li>
          </ul>
          <p>
            Write what each task is, then mark it <b>·</b> not done, <b>½</b> half done or <b>✓</b> done. A full day
            scores 100. Task names are private: neighbours only ever see <i>whether</i> you finished, never <i>what</i>.
            The ✓ inside a task box means its name is saved.
          </p>
          <p>Your day ends overnight, not at midnight, so late-evening ticks still count for today.</p>
          <p>
            <b>Plan ahead:</b> the row of days at the top of the Today tab goes a week ahead. Pick a day to write its
            tasks now; the dots show how many are named. You tick them off when the day comes. Its first day is <b>yesterday</b>:
            forgot to tick something off? Do it there the next day. It still earns its action and the extra harvest.
          </p>
        </details>

        <details>
          <summary>Actions: spending what you earn</summary>
          <p>
            Every task you finish earns an action of the same size, shown at the bottom of the map as <b>B</b>,{' '}
            <b>M</b> or <b>S</b>. A half-done task shows a half-filled action: it still counts toward your score,
            and two half-done actions of the same size join into a whole one you can spend. A bigger action can pay for a smaller one.
            Tap a hex on the map to see what you can do there.
          </p>
          <ul>
            <li><b>Small:</b> {bySize('small').map((a) => a.name).join(', ')}.</li>
            <li><b>Medium:</b> {bySize('medium').map((a) => a.name).join(', ')}.</li>
            <li><b>Big:</b> {bySize('big').map((a) => a.name).join(', ')}.</li>
          </ul>
          <p>
            Unspent actions keep until the season ends, so a half-done one can wait for a partner. There's little to
            gain by saving them, though: buildings start producing the night they're finished, and monster lairs only grow stronger.
          </p>
        </details>

        <details>
          <summary>Your village</summary>
          <p>
            You found your village by tapping a spot on the map. Your land is the hexes within two of the village
            (yellow border); outposts add more. Villagers need food (about half a unit each a day), houses to live in,
            and good morale to grow. The <b>Village</b> tab shows people, defence, food in store and goods.
          </p>
          <ul>
            <li>Buildings produce every night. How much depends on how well your day went (a good day means a good harvest).</li>
            <li>Fresh food (fish, berries, bread, game) partly spoils each night. Grain, smoked fish and cheese keep, and a granary stores more.</li>
            <li>Eating a variety of foods lifts morale. Running short hurts morale, and families may leave.</li>
            <li>Buildings that match your village's role produce 25% more. Other roles' buildings cost double.</li>
          </ul>
          <p>Wrong spot or role? The Village tab lets you abandon your village and start again somewhere new. That resets your progress, but the map you explored stays known.</p>
        </details>

        <details>
          <summary>Roles: who does what</summary>
          <p>Each village has a role, and neighbours depend on each other. When you settle, stars show what the land within 3 hexes suits, but any role works anywhere.</p>
          <ul>
            {(['farm', 'port', 'mining', 'forestry', 'herding', 'explorer'] as const).map((r) => (
              <li key={r}><b>{ROLE_INFO[r].name}:</b> {ROLE_INFO[r].blurb} <span className="muted">Builds: {roleBuildings(r)}.</span></li>
            ))}
          </ul>
          <p className="muted">Every village can also build: {roleBuildings('any')}.</p>
        </details>

        <details>
          <summary>The week and the season</summary>
          <p>Every week runs through four seasons, which change how crops grow:</p>
          <ul>
            <li>🌱 <b>Spring</b> (Sunday, Monday): crops at 70%.</li>
            <li>☀️ <b>Summer</b> (Tuesday, Wednesday): crops at 110%.</li>
            <li>🍂 <b>Autumn</b> (Thursday, Friday): crops at 140%, so harvest and stock up.</li>
            <li>❄️ <b>Winter</b> (Saturday): the Sabbath, a day of rest. There are no tasks, just your habits. Nothing grows,
              the village lives off its stores, and the day counts like a frozen one.</li>
          </ul>
          <p>On Thursday and Friday the Village tab forecasts winter as <i>stocked</i>, <i>tight</i> or <i>hungry</i>. A season lasts {SEASON_WEEKS} weeks.</p>
          <p>
            The <b>Winter prep</b> checklist in the Village tab shows what's still missing: food that keeps (grain,
            smoked fish, cheese), room to store it, a palisade if your stores look thin, and a varied larder. It
            suggests what to do with each size of task, and how much food that keeps a full day of tasks will make tonight.
          </p>
        </details>

        <details>
          <summary>Habits</summary>
          <p>Habits are small daily things that also help your village:</p>
          <ul>{HABIT_PRESETS.map((h) => <li key={h.id}><b>{h.name}:</b> {h.blurb}.</li>)}</ul>
          <p>
            You start with one habit slot. Do all your habits for {PERFECT_DAYS_PER_SLOT} days to unlock another, up to {MAX_HABIT_SLOTS}.
            Missing a day never takes a slot away, and Saturday misses don't break your streak.
          </p>
          <p>
            <b>Water</b> is a tracker: set a daily target and unit (8 cups, 2 L, 64 oz…), log what you drink with the
            quick buttons, and watch the glass fill. Reaching the target ticks the habit. The bars show the last two weeks.
          </p>
          <p><b>Freezes:</b> one a week. Freezing a bad day (illness, travel) counts it as at least 60 and pauses your streak instead of breaking it.</p>
        </details>

        <details>
          <summary>The map: exploring, roads and monsters</summary>
          <ul>
            <li>The mist is unexplored land. <b>Scout</b> from the edge of what anyone knows: everyone in the world shares one map.</li>
            <li><b>Roads</b> speed caravans, and your villagers love them. A road across a river needs a <b>bridge</b>: a medium task instead of a small one. <b>Fell a tree</b> for timber: each one leaves a stump, and every winter the trees left standing double, back up to what the hex first had. Fell the last tree and the land is open for good, ready to build on. <b>Plant</b> two saplings to start a wood: they become trees in winter and spread from there.</li>
            <li>Monster lairs (goblins, orcs, trolls, a dragon) grow bolder as villages grow and sometimes raid your stores. A palisade helps.</li>
            <li>An <b>expedition</b> (big action) takes on a lair for loot. Food, metal weapons, leather and an outfitter make it likelier to win.</li>
            <li>Merchants call at every village each day except the Sabbath (see <b>Caravans</b>). Barter goods from your stores for what's in their packs; copper and silver are coin every merchant takes. A coast, a river and long roads bring more merchants, bigger loads and better prices. Each merchant can only carry so much weight.</li>
          </ul>
          <p>
            <b>What's in the ground:</b> outcrops show deposits: rusty boulders for iron, weathered rock crusted with green
            malachite and blue azurite on a rust-stained patch for copper (in the hills and mountains, and now and then in
            dry basins and lowland), pale slabs for building stone, dark crystals for rare tin, red clay banks along rivers and white salt
            crusts. In the mountains, ore streaks the rock itself: green and blue with a rusty halo for copper, rust for iron. Tap a hex to see
            what you could build there, or press ⛏ by the zoom buttons to dim everything except deposits.
          </p>
          <p>
            <b>It runs out:</b> every hex has some loose stone. <b>Clear stone</b> (small task) picks it up for building, and a field
            cleared of stone grows a fifth more. Once it's picked clean, only a quarry reaches the rock below. Ore works the same way:
            a little at the surface to gather by hand, and much more underground for a mine. Surface copper (malachite) has no silver;
            a copper mine's deep ore brings up a trickle of silver ore. Rich silver ore (grey galena) lies in a few far mountains, streaking the rock
            grey. Game hunted from a hex comes back slowly, about one animal a day. Tap a hex to see roughly how much is left.
          </p>
          <p>Drag to move around; pinch, scroll or use ＋/－ to zoom. Zoom right out to see the whole continent.</p>
        </details>

        <details>
          <summary>Playing together</summary>
          <ul>
            <li>The <b>Party</b> tab shows your neighbours: today's pips, and a bar for each of the last seven days (gold for a perfect day, blue for a frozen one) with their average. Whether they finished their tasks, never what they were.</li>
            <li>Send a <b>caravan</b> (medium action) to share goods with a neighbour. It takes time on the road; walking habits speed it up.</li>
            <li>Tap a hex and <b>🔗 Share</b>, or use <b>Invite someone to settle nearby</b> in the Village tab, to text someone a link to that spot.</li>
            <li>Villages need a little space: you can't settle right next to someone else's land (shown in red while choosing).</li>
            <li>
              Quex has two worlds: the <b>sandbox</b>, open to anyone who wants to try it, and a smaller world where friends and
              family are playtesting. Anyone can look around the family world, but only its players can play there. Visitors
              never see task names or how anyone's day went.
            </li>
          </ul>
        </details>

        <details>
          <summary>Families: parents and children</summary>
          <p>
            A child can have their tasks set and checked off by a parent or grandparent, while still choosing their own
            actions and exploring.
          </p>
          <ol>
            <li>On the child's account: <b>Account → Add a parent or guardian</b>. This makes a one-time link (valid for 7 days).</li>
            <li>The parent opens the link while signed in to <i>their own</i> account.</li>
            <li>The parent's Party tab now has <b>Set & check tasks</b> for that child: task names, ticks, habits, water and freezes.</li>
          </ol>
          <p>Add as many parents and grandparents as you like, one link each. The child's Today tab shows who sets their tasks.</p>
        </details>

        <details>
          <summary>Your account</summary>
          <ul>
            <li>Sign in with an emailed 6-digit code, or set a password under <b>Account</b>.</li>
            <li>Your village and task names follow you to any device you sign in on.</li>
            <li><b>Account → Rename</b> changes your name in the world (your village follows).</li>
            <li><b>Switch account</b> signs out and lists the accounts used on this device. Switching still asks for a code or password.</li>
          </ul>
        </details>

        <details>
          <summary>Planning with an AI assistant</summary>
          <p>
            Claude, ChatGPT and other assistants can read your task list and plan days ahead with you: "plan my week",
            or, for a parent, "plan my son's tasks for tomorrow".
          </p>
          <ol>
            <li><b>Account → Connect an AI assistant</b> makes a private link. Copy it straight away.</li>
            <li><b>Claude:</b> Settings → Connectors → Add custom connector, and paste the link as the URL.</li>
            <li><b>ChatGPT:</b> Settings → Apps & Connectors → Advanced → Developer mode, then Create, paste the link, no authentication.</li>
          </ol>
          <p>
            The assistant can see and write task names for you and any children you look after, from yesterday up to two
            weeks ahead. It can't tick tasks off, take actions or change your village, and a child's own assistant can't
            change tasks a parent sets. Treat the link like a password; <b>Turn off</b> in Account stops it at once.
          </p>
        </details>
        <p className="muted build" title={`Built ${new Date(__BUILD_TIME__).toLocaleString()}`}>
          Version {__BUILD_COMMIT__} · built {new Date(__BUILD_TIME__).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}
