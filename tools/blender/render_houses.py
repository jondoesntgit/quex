"""Render medieval village buildings with the game's own Blender camera and flat materials.
Run: Blender --background --factory-startup --python render_houses.py   (env REPO, OUT)"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix
REPO=os.environ['REPO']; OUT=os.environ['OUT']
__file__=REPO+'/tools/blender/render_tiles.py'
src=open(__file__).read(); src=src[:src.index('\ndef main():')]
exec(compile(src,__file__,'exec'),globals())

L=Vector((-0.55,-0.35,0.76)).normalized()
def lvl(n):
    d=n.dot(L); return 0 if d>0.5 else (1 if d>0.2 else 2)
def solid(name,verts,faces,pal):
    bm=bmesh.new(); vs=[bm.verts.new(Vector(v)) for v in verts]
    for f in faces: bm.faces.new([vs[i] for i in f])
    bm.normal_update()
    for f in bm.faces: f.material_index=lvl(f.normal)
    return link(bm,name,[mat(c) for c in pal])
def bar(p0,p1,t,color):
    p0,p1=Vector(p0),Vector(p1); d=p1-p0; ln=d.length
    bm=bmesh.new(); bmesh.ops.create_cube(bm,size=1.0); bmesh.ops.scale(bm,vec=(ln,t,t),verts=bm.verts)
    q=Vector((1,0,0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm,matrix=Matrix.Translation((p0+p1)/2)@q,verts=bm.verts)
    return link(bm,'bar',[mat(color)])
def pyramid(c,half,z0,z1,pal):
    x,y,_=c; v=[(x-half,y-half,z0),(x+half,y-half,z0),(x+half,y+half,z0),(x-half,y+half,z0),(x,y,z1)]
    return solid('pyr',v,[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],pal)
PLASTER=('#f8e8c0','#e8d0a0','#c0a070'); PLASTER2=('#f0dcb0','#dcc090','#b49462'); WHITE=('#fcf4dc','#f0e6c8','#cfc3a0')
STONE=('#d8d4c8','#b4b0a4','#7c786c'); PLANK=('#d0a068','#b88048','#805028')
ROOFS={'tile':('#f06848','#d84830','#a03020'),'tile2':('#e0603c','#c24028','#8c2c1c'),'thatch':('#ecd488','#d4b464','#a88a40'),
       'shingle':('#c49468','#a47446','#7c5430'),'slate':('#b0b6c2','#8a909c','#646a78')}
TIMBER='#5e4028'; DOORC='#8a5630'; WINC='#f8e890'
def gable(xe,ye,z0,z1,pal,hip=0.0,ends=True):
    xr=xe-hip
    v=[(-xe,-ye,z0),(xe,-ye,z0),(xr,0,z1),(-xr,0,z1),(-xe,ye,z0),(xe,ye,z0),(xr,0,z1),(-xr,0,z1)]
    verts=[(-xe,-ye,z0),(xe,-ye,z0),(xr,0,z1),(-xr,0,z1),(-xe,ye,z0),(xe,ye,z0)]
    return solid('roof',verts,[(0,1,2,3),(3,2,5,4)]+([(0,3,4),(1,5,2)] if ends else []),pal)
def house(spec):
    A,B,h,r=spec['A'],spec['B'],spec['h'],spec['r']; kind=spec['kind']; objs=[]
    wp=spec.get('wall',PLASTER); rp=ROOFS[spec['roof']]; o=0.045; oe=0.035
    hip=(B+o)*0.95 if spec.get('hip') else 0.0
    if kind=='hall':
        h1=spec['h1']; h2=h-h1
        objs.append(box((0,0,0),(2*A,2*B,h1),wp[1],wp)); objs.append(box((0,0,h1),(2*A+0.05,2*B+0.05,h2),wp[1],PLASTER2))
        A2,B2=A+0.025,B+0.025
    else:
        objs.append(box((0,0,0),(2*A,2*B,h),wp[1],wp)); A2,B2=A,B
    # timber frame on the long wall (and the jetty)
    if spec.get('timber'):
        n=max(3,int(A*10)); 
        for k in range(n+1):
            x=-A+0.02+k*(2*A-0.04)/n; objs.append(bar((x,-B2-0.006,0.0),(x,-B2-0.006,h),0.014,TIMBER))
        objs.append(bar((-A,-B2-0.006,h-0.01),(A,-B2-0.006,h-0.01),0.014,TIMBER)); objs.append(bar((-A,-B2-0.006,0.012),(A,-B2-0.006,0.012),0.014,TIMBER))
        if kind=='hall': objs.append(bar((-A,-B2-0.006,spec['h1']),(A,-B2-0.006,spec['h1']),0.018,TIMBER))
        objs.append(bar((-A+0.02,-B2-0.006,0.0),(-A+2*(2*A-0.04)/n,-B2-0.006,h),0.012,TIMBER))
    # roof
    gf=spec.get('gablefront'); h1=spec.get('h1',h)
    objs.append(gable(A2+oe,B2+o,h-0.012,h+r,rp,hip,ends=not gf))
    if gf:
        for sx in (-1,1):
            xw=sx*(A2+0.004)
            objs.append(solid('gw',[(xw,-B2,h-0.012),(xw,B2,h-0.012),(xw,0,h+r-0.012)],[(0,1,2) if sx>0 else (2,1,0)],wp))
        fx=-A2-0.012
        if spec.get('timber'):
            for (y0,z0,y1,z1) in [(-B2,h1,B2,h1),(-B2,h-0.01,B2,h-0.01),(-B2,h1,-B2,h),(B2,h1,B2,h),(-B2,0,-B2,h1),(B2,0,B2,h1),(-B2,h-0.01,0,h+r-0.02),(B2,h-0.01,0,h+r-0.02)]:
                objs.append(bar((fx-0.004,y0,z0),(fx-0.004,y1,z1),0.016,TIMBER))
        for wy in (-B2*0.5,B2*0.5): objs.append(box((fx-0.01,wy,h1+0.07),(0.016,0.075,0.09),WINC,(WINC,)*3))
        objs.append(box((fx-0.01,0,h+0.04),(0.016,0.05,0.06),WINC,(WINC,)*3))
    # chimney
    sx=spec.get('chim',1)
    objs.append(box((sx*A*0.55,0.0,h+0.01),(0.05,0.05,r+0.075),STONE[1],STONE))
    # door + windows on the front (-Y) wall, or on the gable end (-X) when the house faces the street end-on
    dh=0.25; DW=0.15; FR='#e9dcb4'
    if spec['face']=='long':
        dx=spec.get('dx',0.0)
        if spec.get('open'):
            a=math.radians(75); hx_,hy_=dx-DW/2,-B2-0.012
            objs.append(box((dx,-B2-0.006,0),(DW,0.018,dh),'#1c120a',('#1c120a',)*3)); objs.append(box((hx_+math.cos(a)*DW/2,hy_-math.sin(a)*DW/2,0),(DW,0.02,dh),DOORC,(DOORC,)*3,rot=-a))
        else:
            objs.append(box((dx,-B2-0.012,0),(DW,0.018,dh),DOORC,(DOORC,)*3)); objs.append(bar((dx,-B2-0.024,0),(dx,-B2-0.024,dh),0.012,'#5a3418')); objs.append(bar((dx-DW/2,-B2-0.024,dh*0.62),(dx+DW/2,-B2-0.024,dh*0.62),0.01,'#5a3418'))
        for wx in (-A*0.68,A*0.68):
            if abs(wx-dx)>0.14: objs.append(box((wx,-B2-0.008,0.13),(0.07,0.014,0.08),WINC,(WINC,)*3))
        if kind=='hall':
            for wx in (-A*0.55,A*0.55): objs.append(box((wx,-B2-0.008,spec['h1']+0.05),(0.07,0.014,0.07),WINC,(WINC,)*3))
    else:
        if spec.get('open'):
            a=math.radians(75); hx_,hy_=-A2-0.012,-DW/2
            objs.append(box((-A2-0.006,0,0),(0.018,DW,dh),'#1c120a',('#1c120a',)*3)); objs.append(box((hx_-math.sin(a)*DW/2,hy_+math.cos(a)*DW/2,0),(0.02,DW,dh),DOORC,(DOORC,)*3,rot=-a))
        else:
            objs.append(box((-A2-0.012,0,0),(0.018,DW,dh),DOORC,(DOORC,)*3)); objs.append(bar((-A2-0.024,0,0),(-A2-0.024,0,dh),0.012,'#5a3418'))
        if kind=='hall' and not spec.get('gablefront'):
            for wy in (-B2*0.5,B2*0.5): objs.append(box((-A2-0.033,wy,spec['h1']+0.06),(0.016,0.07,0.08),WINC,(WINC,)*3))
    return objs
def barn(spec):
    A,B,h,r=spec['A'],spec['B'],spec['h'],spec['r']; rp=ROOFS[spec['roof']]; objs=[box((0,0,0),(2*A,2*B,h),PLANK[1],PLANK)]
    for k in range(9):
        x=-A+0.03+k*(2*A-0.06)/8; objs.append(bar((x,-B-0.005,0),(x,-B-0.005,h),0.012,'#6a4426'))
    objs.append(box((0,-B-0.012,0),(0.16,0.02,0.125),'#4a2c18',('#4a2c18',)*3)); objs.append(bar((-0.08,-B-0.024,0.0),(0.08,-B-0.024,0.125),0.012,'#8a6038')); objs.append(bar((-0.08,-B-0.024,0.125),(0.08,-B-0.024,0.0),0.012,'#8a6038'))
    objs.append(gable(A+0.03,B+0.045,h-0.01,h+r,rp,(B+0.045)*0.9))
    return objs
def manor(spec):
    A,B=0.54,0.31; h1,h2,r=0.29,0.17,0.2; spec2=dict(A=A,B=B,h=h1+h2,r=r,kind='hall',h1=h1,roof='tile2',timber=True,face='long',dx=0.0,chim=1,wall=WHITE,hip=False)
    objs=house(spec2); objs.append(box((-A*0.55,0.0,h1+h2+0.01),(0.05,0.05,r+0.075),STONE[1],STONE))
    objs.append(bar((A*0.88,0,h1+h2+r*0.9),(A*0.88,0,h1+h2+r+0.3),0.012,'#5a3a20')); fx=A*0.88; fz=h1+h2+r
    objs.append(solid('flag',[(fx,0,fz+0.3),(fx,0,fz+0.18),(fx+0.14,0,fz+0.24),(fx,0.005,fz+0.3),(fx,0.005,fz+0.18),(fx+0.14,0.005,fz+0.24)],[(0,1,2),(5,4,3)],('#e03a3a','#e03a3a','#e03a3a')))
    return objs
def church(spec):
    A,B,h,r=0.52,0.24,0.2,0.2
    CST=('#efe6cc','#c9bc9c','#8a7d62'); PLINTH=('#a89a7c','#857a62','#5e5644'); SLATEC=('#7e8cae','#56648a','#38425e'); DARK='#23233a'; GLASS='#6f93d8'; TRIM='#f4ecd0'
    objs=[box((0,0,0),(2*A+0.04,2*B+0.04,0.035),PLINTH[1],PLINTH), box((0,0,0.03),(2*A,2*B,h-0.03),CST[1],CST)]
    for bx in (-A,-A*0.3,A*0.4): objs.append(box((bx,-B-0.018,0.03),(0.035,0.04,h-0.05),CST[0],CST))      # buttresses
    for wx in (-A*0.65,-A*0.0,A*0.7-0.2):
        objs.append(box((wx-A*0.0+(-0.0),-B-0.008,0.07),(0.05,0.016,0.1),DARK,(DARK,)*3)); objs.append(box((wx,-B-0.012,0.085),(0.026,0.016,0.07),GLASS,(GLASS,)*3))
    objs.append(gable(A+0.035,B+0.05,h-0.01,h+r,SLATEC,0.0)); objs.append(bar((-A-0.035,0,h+r+0.004),(A+0.035,0,h+r+0.004),0.016,'#c8d4ec'))
    tx=A+0.13; objs.append(box((tx,0,0),(0.22,0.22,0.64),CST[1],CST)); objs.append(box((tx,0,0),(0.25,0.25,0.04),PLINTH[1],PLINTH))
    objs.append(bar((tx-0.125,-0.118,0.34),(tx+0.125,-0.118,0.34),0.014,'#9a8e76'))                                    # string course
    objs.append(box((tx,-0.123,0.0),(0.085,0.02,0.125),DARK,(DARK,)*3)); objs.append(bar((tx-0.05,-0.14,0.125),(tx+0.05,-0.14,0.125),0.016,TRIM)); objs.append(bar((tx-0.045,-0.14,0.0),(tx-0.045,-0.14,0.125),0.014,TRIM)); objs.append(bar((tx+0.045,-0.14,0.0),(tx+0.045,-0.14,0.125),0.014,TRIM))
    objs.append(box((tx,-0.123,0.47),(0.085,0.02,0.115),DARK,(DARK,)*3))
    for k in range(3): objs.append(bar((tx-0.04,-0.138,0.5+k*0.03-0.04),(tx+0.04,-0.138,0.5+k*0.03-0.04),0.012,'#7c6a52'))      # belfry louvres
    objs.append(box((tx-0.1-0.01,0,0.47),(0.02,0.085,0.115),DARK,(DARK,)*3))
    objs.append(pyramid((tx,0,0),0.135,0.64,1.0,('#7a5a52','#5a3e38','#3e2a26')))
    objs.append(bar((tx,0,1.0),(tx,0,1.13),0.016,TRIM)); objs.append(bar((tx-0.045,0,1.085),(tx+0.045,0,1.085),0.016,TRIM))
    return objs
def well(spec):
    objs=[cone((0,0,0),0.1,0.075,STONE[1],segs=10,r_top=0.1),cone((0,0,0.07),0.07,0.008,'#2e4e74',segs=10,r_top=0.07)]
    for sx in (-0.085,0.085): objs.append(bar((sx,0,0.07),(sx,0,0.23),0.014,'#6a4426'))
    objs.append(bar((-0.085,0,0.23),(0.085,0,0.23),0.014,'#6a4426')); objs.append(gable(0.11,0.09,0.225,0.29,ROOFS['tile'],0.0))
    return objs
def stall(spec):
    c=spec['color']; objs=[box((0,0,0),(0.3,0.13,0.075),PLANK[1],PLANK)]
    for sx in (-0.14,0.14):
        for sy in (-0.1,0.1): objs.append(bar((sx,sy,0),(sx,sy,0.2),0.012,'#6a4426'))
    for k in range(6):
        x0=-0.17+k*0.0567; col=c if k%2==0 else '#f6f2e0'
        objs.append(solid('aw',[(x0,0.12,0.2),(x0+0.0567,0.12,0.2),(x0+0.0567,-0.14,0.13),(x0,-0.14,0.13),(x0,0.12,0.19),(x0+0.0567,0.12,0.19),(x0+0.0567,-0.14,0.12),(x0,-0.14,0.12)],[(0,1,2,3),(7,6,5,4)],(col,col,col)))
    return objs
SIZES={'S':(0.26,0.19,0.29,0.15),'M':(0.31,0.21,0.30,0.17),'L':(0.36,0.23,0.31,0.18)}
CAT={}
for sz,(A,B,h,r) in SIZES.items():
    for roof in ('tile','tile2','thatch','shingle','slate'):
        for orient in ('x','y'):
            for tim in (0,1):
                CAT[f'c_{sz}_{roof}_{orient}_{tim}']=dict(fn=house,kind='cottage',A=A,B=B,h=h,r=r,roof=roof,timber=tim,hip=(roof=='thatch'),orient=orient,face='long' if orient=='x' else 'end',chim=1 if roof in('tile','tile2','slate') else -1,dx=0.0,wall=PLASTER if tim else (WHITE if roof=='slate' else PLASTER2))
for sz,(A,B,h,r) in {'M':(0.33,0.22,0.46,0.17),'L':(0.40,0.24,0.48,0.18)}.items():
    for roof in ('tile','shingle','slate'):
        for orient in ('x','y'):
            CAT[f'h_{sz}_{roof}_{orient}']=dict(fn=house,kind='hall',A=A,B=B,h=h,r=r,h1=0.29,roof=roof,timber=1,hip=False,orient=orient,face='long' if orient=='x' else 'end',chim=1,dx=0.0,wall=PLASTER)
TW={0:PLASTER,1:WHITE,2:PLASTER2}
for roof in ('tile','tile2','slate','shingle'):
    for orient in ('y',):
        for wv in (0,1,2):
            CAT[f't_{roof}_{orient}_{wv}']=dict(fn=house,kind='hall',gablefront=True,A=0.30,B=0.2,h=0.50,r=0.21,h1=0.29,roof=roof,timber=1 if wv!=1 else 0,hip=False,orient=orient,face='end',chim=1,dx=0.0,wall=TW[wv])
for k in [k for k in CAT if k[0] in 'cht']: CAT[k+'_o']=dict(CAT[k],open=True); CAT[k+'_b']=dict(CAT[k],back=True)
for roof in ('thatch','shingle'): CAT[f'b_{roof}']=dict(fn=barn,A=0.5,B=0.26,h=0.15,r=0.2,roof=roof,orient='x')
CAT['manor']=dict(fn=manor,orient='x'); CAT['church']=dict(fn=church,orient='x'); CAT['well']=dict(fn=well,orient='x')
CAT['stall_r']=dict(fn=stall,color='#d83a34',orient='x'); CAT['stall_b']=dict(fn=stall,color='#3a6ec8',orient='x')
if __name__=='__main__' or True:
    only=os.environ.get('ONLY'); W=64; H=96; ax,ay=W//2,H-W//4
    reset_scene(); os.makedirs(OUT,exist_ok=True); done=[]; FP={}
    for key,spec in CAT.items():
        if only and not any(key.startswith(p) for p in only.split(',')): continue
        clear_objects(); objs=spec['fn'](spec)
        rz=(math.pi/2 if spec.get('orient')=='y' else 0.0)+(math.pi if spec.get('back') else 0.0)
        for ob in objs: ob.rotation_euler.z=rz
        if not spec.get('open') and not spec.get('back'):
            # footprint on the ground: every vertex of the model (walls, eaves, chimney, door), after turning
            bpy.context.view_layer.update(); xs=[]; ys=[]
            for ob in objs:
                for vt in ob.data.vertices:
                    w=ob.matrix_world @ vt.co; xs.append(w.x); ys.append(w.y)
            FP[key]=[min(xs),max(xs),min(ys),max(ys)]
        setup_camera(W,H,ax,ay); render(os.path.join(OUT,key+'.png')); done.append(key)
    json.dump(done,open(os.path.join(OUT,'manifest.json'),'w'))
    if not only: json.dump(FP,open(os.path.join(OUT,'footprints.json'),'w'),indent=0)
