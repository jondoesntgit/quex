import { ACTIONS, BUILDINGS, GOOD_LABEL, HABIT_PRESETS, MAX_DEPTH, MAX_HABIT_SLOTS, ORES, PERFECT_DAYS_PER_SLOT, SIZE_POINTS, STATION_RATE, type Good } from '../game/data'
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
            and two half-done actions of the same size join into a whole one you can spend. A bigger action can pay for a smaller one,
            or tap a whole one in the tray to <b>split</b> it: a big into a medium and a small, a medium into two small. Splitting
            only goes one way: small ones never join back into a bigger one.
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
            (yellow border); outposts add more. Villagers eat one ration of food each a day, homes to live in,
            and good morale to grow. The <b>Village</b> tab shows people, defence, food in store and goods.
          </p>
          <ul>
            <li><b>Units:</b> a <b>wagon load</b> is 1,000 lb, and timber, stone, clay, bricks and ore are counted in them. Food is counted in <b>rations</b>, one person's food for a day (2 to 4 lb: a wagon holds about 500 of grain). Salt is counted in pinches, one to a ration of cheese or cured meat. Metals are counted in ingots (50 lb each, silver 12); caravans and merchants carry by real weight.</li>
            <li>Buildings produce every night. How much depends on how well your day went (a good day means a good harvest).</li>
            <li>Fresh food (fish, berries, bread, game) partly spoils each night. Grain, smoked fish and cheese keep, and a granary stores more. Baking and smoking don't make more food: 3 grain bake 2 loaves (the same food, but bread lifts morale and weighs half as much), and smoking dries fish out (2 fish make 1.6) so it keeps through winter.</li>
            <li>Eating a variety of foods lifts morale. Running short hurts morale, and families may leave.</li>
            <li><b>Workers:</b> your people at home do the work. Each building needs a good few hands (a field 10, a mine 15, a kiln 5), and one with half its workers makes half as much. The village manages its workers for you (food buildings first; once the stores are full, only enough on food to feed everyone, the rest on other work), or switch that off in the Village tab and assign them yourself. People not working are free to go with a caravan or as troops; while they're away they're still yours (their houses kept), but they can't work until they're home.</li>
            <li><b>More people</b> settle when three things hold: room in the homes (the village square holds 30; each cottage you build in the city holds 12 more, each town house 24; lay cobblestone next to the city first), morale of at least 45, and the village making at least as much food as it eats (spoiling and rotting count). The Village tab ticks them off for tonight.</li>
          </ul>
          <p>Wrong spot? The Village tab lets you abandon your village and start again somewhere new. That resets your progress, but the map you explored stays known.</p>
        </details>

        <details>
          <summary>Specialising: who does what</summary>
          <p>Any village can build anything, at the same price. But no one village has the land, the hands or the tasks to do it all, so neighbours do best when they split the work: one farms, one mines, one fishes and trades, and caravans carry the rest. Who takes what is for you and your friends to work out, and you can change your mind as you go. When you settle, stars show what the land within 3 hexes suits.</p>
          <ul>
            {(['farm', 'port', 'mining', 'forestry', 'herding', 'explorer'] as const).map((r) => (
              <li key={r}><b>{ROLE_INFO[r].name}:</b> {ROLE_INFO[r].blurb} <span className="muted">Buildings: {roleBuildings(r)}.</span></li>
            ))}
          </ul>
          <p className="muted">And what every village wants: {roleBuildings('any')}.</p>
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
            <li><b>Roads</b> speed caravans, and your villagers love them. A road across a river needs a <b>bridge</b>: a medium task instead of a small one. <b>Fell a tree</b> for timber: each one leaves a stump, and every winter the trees left standing double, back up to what the hex first had. Fell the last tree and the land is open for good, ready to build on (though each winter a few wild saplings come up on bare land around a village, anywhere but desert, beach and bare rock). <b>Plant</b> two saplings to start a wood: they become trees in winter and spread from there. <b>Pave</b> a road (small task, 2 stone) and caravans along it carry more and go faster.</li>
            <li><b>Speed:</b> overland, a caravan takes about four hours a hex, so a far neighbour is days away. A dirt road is three times as fast, and a paved one three times faster again (nine times in all).</li>
            <li><b>Work it</b> (small task): tap one of your buildings to put in an extra shift. It makes a night's worth right away, if it has what it needs. Crops grow in their own time. The Village tab shows what each good will gain or lose tonight; rare finds show as a range, like 0 to 1.</li>
            <li><b>Clay</b> for bricks: gather a clay deposit, or <b>Dig clay</b> (small task) from a riverbank, a marsh, or a pit in the plains or a hill valley. Some mountains hide a small spring with white kaolin clay; tap a mountain hex to find one. Riverbanks, marshes and springs fill up again every winter; a pit, once dug out, is gone. The pedlar always brings some timber and clay to a village that's short.</li>
            <li><b>Water:</b> sheep pens, dairies and mule stables need fresh water within a hex (a river, a marsh, a mountain spring, a pond or a well; the sea is salt). Without it the herd gives half. <b>Dig a well</b> (medium task, 3 stone) for water that never runs dry. Game comes back faster near water too.</li>
            <li>Monster lairs (goblins, orcs, trolls, a dragon) grow bolder as villages grow and sometimes raid your stores. A palisade helps.</li>
            <li>An <b>expedition</b> (big action) takes on a lair for loot. Food, metal weapons, leather and an outfitter make it likelier to win.</li>
            <li><b>Lending troops:</b> neighbours can <b>Send troops</b> (medium task) to a village with a palisade, with weapons, armour and food. They wait at the gate until that village takes them in (Village tab) or turns them back. On its walls they help keep raiders off and march on its expeditions, eating only the food they brought; when it runs out, they walk home with their gear. Each palisade holds ten.</li>
            <li><b>Gunpowder and sieges</b> (the end of the ladder): <b>Nitre beds</b> (beside a Sheep pen) grow saltpetre; roasting chalcopyrite gives off sulfur; a <b>Powder mill</b> grinds them with charcoal into gunpowder. A <b>Gun foundry</b> casts cannonballs, or bronze cannon; a <b>Gunsmith</b> makes muskets; a <b>Siege workshop</b> builds battering rams and siege towers (tap a workshop to choose what it makes). Out in the far wastelands stand warlords' <b>strongholds</b>: their walls triple their strength. Each ram brings them down by half a time, each siege tower by three-quarters, each cannon (with 2 shot and 2 powder) by a whole time, and every musket (with a charge of powder) strengthens the assault. <b>Lay siege</b> (big task): powder, shot and engines are spent, win or lose, and a fallen keep's hoard is yours.</li>
            <li>Merchants call at every village each day except the Sabbath (see <b>Caravans</b>). Barter goods from your stores for what's in their packs; copper and silver are coin every merchant takes. A coast, a river and long roads bring more merchants, bigger loads and better prices. Each merchant can only carry so much weight.</li>
          </ul>
          <p>
            <b>What's in the ground:</b> rocks scattered on a hex show its deposit: rusty boulders for iron, grey rock patched with
            green malachite for copper (in the hills and mountains, and now and then in dry basins and lowland), pale slabs for
            building stone, dark crystal-studded rock for rare tin, red clay banks along rivers and white salt crusts. Fewer
            rocks means the surface is nearly worked out; one stays while there's more below. Small grey pebbles are loose stone. In the mountains, ore streaks the rock itself: green and blue with a rusty halo for copper, rust for iron. Tap a hex to see
            what you could build there, or press ⛏ by the zoom buttons to dim everything except deposits.
          </p>
          <p>
            <b>It runs out:</b> every hex has some loose stone (the grey pebbles). <b>Clear stone</b> (small task) picks it up for building, and a field
            cleared of stone grows a fifth more. Once it's picked clean, only a quarry reaches the rock below. Ore works the same way:
            a little at the surface to gather by hand, and much more underground for a mine. Game hunted from a hex comes back slowly,
            about one animal a day. Tap a hex to see roughly how much is left.
          </p>
          <p>
            <b>Mines and quarries go down in levels.</b> They start one level down; <b>Sink the shaft</b> (big task, plus timber and planks to
            shore it up) takes it to level {MAX_DEPTH} at most. Each level holds more ore, and different ore: near the surface it's
            weathered (green malachite, rusty limonite); deeper down come brassy chalcopyrite, hematite and black magnetite. Tap a mine
            to see its levels. Rich silver ore (grey galena) lies in a few far mountains, and deep copper ore carries a little.
          </p>
          <p>
            <b>Dungeons:</b> sink a shaft two or more levels under a mountain and the miners may break into something: a troglodyte
            warren, a spider nest, a forgotten dwarf hall... An expedition (big task) goes down the shaft for its loot, but each one
            only holds so much.
          </p>
          <p><b>Working ore into metal</b> (each station takes up to {STATION_RATE} ore a night on a full day, easiest first):</p>
          <ul>
            {(Object.keys(ORES) as Good[]).map((g) => {
              const o = ORES[g]!
              return <li key={g}><b>{GOOD_LABEL[g]}</b> → {o.yield} {GOOD_LABEL[o.metal].toLowerCase()} each at a {BUILDINGS[o.station].name}{o.with ? ` (with a ${BUILDINGS[o.with].name})` : ''}, burning {o.fuel} charcoal. <span className="muted">{o.note}</span></li>
            })}
          </ul>
          <p>Drag to move around; pinch, scroll or use ＋/－ to zoom. Zoom right out to see the whole continent.</p>
        </details>

        <details>
          <summary>Playing together</summary>
          <ul>
            <li>The <b>Party</b> tab shows your neighbours: today's pips, and a bar for each of the last seven days (gold for a perfect day, blue for a frozen one) with their average. Whether they finished their tasks, never what they were.</li>
            <li>Send a <b>caravan</b> to share goods with a neighbour: a medium task across country, a small one when a road connects you, and no task at all on paved road the whole way (with ox carts, which must walk home before they go again). Pick who goes (people not working): each carries 6 weight (a stone weighs 3, timber 2, grain 1); a <b>Mule stable</b> adds 60, and a <b>Cart shed</b> lets ox carts carry up to 100 where roads run the whole way. Paved roads add up to half again. Pack food for the road first: half a unit a person a day, there and back. Its people are away until they're home again. Roads and walking habits speed it up.</li>
            <li>Tap a hex and <b>🔗 Share</b>, or use <b>Invite someone to settle nearby</b> in the Village tab, to text someone a link to that spot.</li>
            <li>Villages need a little space: you can't settle right next to someone else's land (shaded while choosing).</li>
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
