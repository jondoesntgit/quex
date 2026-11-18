# PixelLab sprites (64 px tile scale)

Generated with PixelLab `create_1_direction_object` on the Quex palette, at canvas
sizes chosen so each creature is true-to-scale against 64 px hex tiles:

| sprite | canvas | PixelLab object id | rule |
|---|---|---|---|
| goblin_a / goblin_b | 16 | 1afe18a1-d675-40ff-bee4-1d185bf12cff / f4decb06-2e44-4e3d-ae90-72fb1f6022a2 | shorter than an oak |
| orcs | 24 | aad54177-c350-4f07-a4aa-5a421b9f836d | about tree height |
| troll | 32 | 30bea6cf-ffa9-41b7-a79f-9103f90f93ad | slightly taller than a pine |
| dragon | 56 | 5ba5723e-dafb-484c-8dbc-c2479d057ac6 | fits inside one hex |
| scout | 20 | e581697d-2c12-4e77-b902-dae7371bb4fc | human, between goblin and orc |

`tools/post_tiles.py` swaps these in for the Blender creature sprites when packing the 64 px atlas.
