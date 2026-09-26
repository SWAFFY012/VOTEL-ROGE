import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The Letov guitar as one reusable model: extruded body with the photographed
// front, sides and rear, plus fretboard, frets, strings, pickups, bridge,
// tailpiece and tuners. Used by the
// scroll scene on the landing page and by the release page.

export type GuitarString = {
  // Vibrating length, nut to saddle: a cylinder along its local y axis,
  // centred on the string, with 96 segments so a page can bend it.
  mesh: THREE.Mesh;
  length: number;
  index: number;
};

export type GuitarModel = {
  group: THREE.Group;
  strings: GuitarString[];
  metal: THREE.MeshStandardMaterial;
  dispose: () => void;
};

// lit: the photographed front and rear respond to scene lights as lacquered
// wood (clearcoat), instead of showing the photo flat and unlit.
export function createGuitar(renderer: THREE.WebGLRenderer, onFrontLoaded?: () => void, { lit = false } = {}): GuitarModel {
  const guitar = new THREE.Group();
  // Trace of the LEFT guitar in the supplied 660×777 reference.
  // Photo coordinates are also used as UVs, preserving the original stickers.
  const outline = [
    [134,49],[158,42],[178,51],[173, 70],[177,101],[168,126],[167,144],
    [169,431],[177,460],[191,469],[211,461],[228,467],[239,480],[241,500],
    [228,526],[230,552],[247,580],[261,612],[271,640],[270,665],[259,687],
    [238,706],[209,719],[177,725],[144,723],[114,714],[87,700],[66,681],
    [53,657],[50,632],[56,608],[68,582],[82,560],[93,535],[91,514],
    [78,500],[76,481],[83,465],[103,453],[124,448],[137,437],[145,144],
    [143,128],[133,110],[138,87],[137,66]
  ];

  const points = outline.map(([x,y]) => new THREE.Vector2((x-160)/100, (385-y)/100));
  const shape = new THREE.Shape();
  const first = points[points.length-1].clone().lerp(points[0],.5);
  shape.moveTo(first.x,first.y);
  points.forEach((point,i)=>{
    const next=point.clone().lerp(points[(i+1)%points.length],.5);
    shape.quadraticCurveTo(point.x,point.y,next.x,next.y);
  });
  const loader = new THREE.TextureLoader();
  const setupTexture=(t:THREE.Texture)=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);};
  const sideTexture=loader.load('/guitar-side.png',setupTexture);
  const rearTexture=loader.load('/guitar-back.png',setupTexture);
  const sideMaterial = new THREE.MeshStandardMaterial({ map:sideTexture, roughness:.42, metalness:.06 });
  const interpolate=(rows:number[][],y:number,column:number)=>{
    if(y<=rows[0][0])return rows[0][column];
    for(let j=1;j<rows.length;j++)if(y<=rows[j][0])return THREE.MathUtils.lerp(rows[j-1][column],rows[j][column],(y-rows[j-1][0])/(rows[j][0]-rows[j-1][0]));
    return rows[rows.length-1][column];
  };
  const sourceY=(y:number,rows:number[][])=>interpolate(rows,y,1);
  const sideBounds=[[18,356,389],[100,365,409],[244,394,437],[870,395,444],[930,345,438],[1000,323,432],[1300,306,430],[1600,302,425],[1860,326,424],[1920,339,424]];
  const bodyGeometry = new THREE.ExtrudeGeometry(shape, { depth: .20, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .018, bevelThickness: .018, curveSegments: 16 });
  bodyGeometry.translate(0,0,-.10);
  const edgePos=bodyGeometry.attributes.position,edgeUV=bodyGeometry.attributes.uv;
  for(let i=0;i<edgePos.count;i++){
    const y=sourceY(385-edgePos.getY(i)*100,[[42,18],[144,244],[437,930],[725,1915]]);
    const depth=THREE.MathUtils.clamp((edgePos.getZ(i)+.1)/.2,0,1);
    const x=THREE.MathUtils.lerp(interpolate(sideBounds,y,1),interpolate(sideBounds,y,2),depth);
    edgeUV.setXY(i,x/793,1-y/1983);
  }
  guitar.add(new THREE.Mesh(bodyGeometry, sideMaterial));
  const faceGeometry = new THREE.ShapeGeometry(shape);
  const uv = faceGeometry.attributes.uv;
  const pos = faceGeometry.attributes.position;
  for (let i=0; i<pos.count; i++) uv.setXY(i, (pos.getX(i)*100+160)/660, 1-(385-pos.getY(i)*100)/777);
  const frontMaterial: THREE.MeshBasicMaterial | THREE.MeshPhysicalMaterial = lit
    ? new THREE.MeshPhysicalMaterial({ roughness: .5, metalness: 0, clearcoat: 1, clearcoatRoughness: .14 })
    : new THREE.MeshBasicMaterial({ transparent: false });
  const front = new THREE.Mesh(faceGeometry, frontMaterial);
  front.position.z = .122; guitar.add(front);
  // Same photo with the painted fretboard strings removed (scripts/clean-fretboard.mjs):
  // the 3D strings are the only strings over the neck.
  const texture = loader.load('/guitar-atlas-clean.png', t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(),8);
    frontMaterial.map = t; frontMaterial.needsUpdate = true;
    onFrontLoaded?.();
  });
  // Rear UV projection uses the newly supplied archival rear photograph.
  const backGeometry=faceGeometry.clone();
  const backUV=backGeometry.attributes.uv;
  const contour=shape.getPoints(48);
  const boundsAt=(y:number)=>{
    const intersections:number[]=[];
    for(let i=0;i<contour.length;i++){
      const a=contour[i],b=contour[(i+1)%contour.length];
      if((a.y<=y&&b.y>=y)||(b.y<=y&&a.y>=y)){
        if(Math.abs(a.y-b.y)>.000001)intersections.push(THREE.MathUtils.lerp(a.x,b.x,(y-a.y)/(b.y-a.y)));
      }
    }
    return intersections.length?[Math.min(...intersections),Math.max(...intersections)]:[-.01,.01];
  };
  const rearBounds=[[28,389,400],[55,329,458],[235,332,460],[320,374,414],[400,365,424],[700,355,431],[920,350,438],[955,349,475],[980,341,550],[1020,280,602],[1060,163,625],[1100,137,638],[1150,145,631],[1200,172,615],[1250,184,603],[1300,160,611],[1400,79,680],[1500,45,726],[1600,42,742],[1700,90,696],[1780,181,607],[1820,284,522],[1840,382,409]];
  for(let i=0;i<pos.count;i++){
    const y=sourceY(385-pos.getY(i)*100,[[42,28],[144,320],[437,956],[725,1840]]);
    const [left,right]=boundsAt(pos.getY(i));
    const ratio=THREE.MathUtils.clamp((pos.getX(i)-left)/Math.max(.001,right-left),0,1);
    const x=THREE.MathUtils.lerp(interpolate(rearBounds,y,2),interpolate(rearBounds,y,1),ratio);
    backUV.setXY(i,x/793,1-y/1983);
  }
  const backMaterial=lit
    ? new THREE.MeshPhysicalMaterial({map:rearTexture,side:THREE.BackSide,roughness:.55,clearcoat:.8,clearcoatRoughness:.2})
    : new THREE.MeshBasicMaterial({map:rearTexture,side:THREE.BackSide});
  const back=new THREE.Mesh(backGeometry,backMaterial);
  back.position.z=-.123;guitar.add(back);
  // ── Hardware, placed on the photograph's own features (reference pixels) ──
  const at = (x: number, y: number) => new THREE.Vector2((x - 160) / 100, (385 - y) / 100);
  const face = .122, boardTop = face + .014, stringZ = .151;
  const hardware: THREE.BufferGeometry[] = [];
  const own = <T extends THREE.BufferGeometry>(g: T) => { hardware.push(g); return g; };
  const place = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(own(geometry), material);
    const p = at(x, y); mesh.position.set(p.x, p.y, z); guitar.add(mesh);
    return mesh;
  };
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9d6ce, roughness: .26, metalness: .9 });
  // Brushed-bright chrome: a perfect mirror only shows the dark stage and reads black.
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe4e6e9, roughness: .22, metalness: .85, envMapIntensity: 1.8 });
  const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x0c0b0b, roughness: .5 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xece4d0, roughness: .45 });
  const rosewood = new THREE.MeshStandardMaterial({ color: 0x2b1810, roughness: .55 });
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xece6d8, roughness: .3, clearcoat: 1, clearcoatRoughness: .2 });

  // Fretboard: a raised slab carrying the photographed rosewood and dots.
  const nutY = 143.5, boardEndY = 476;
  const boardEdge = (y: number) => {
    const t = (y - nutY) / (boardEndY - nutY);
    return [THREE.MathUtils.lerp(145.5, 141.5, t), THREE.MathUtils.lerp(166.5, 172.5, t)];
  };
  const boardShape = new THREE.Shape([at(145.5, nutY), at(166.5, nutY), at(172.5, boardEndY), at(141.5, boardEndY)]);
  const boardGeometry = own(new THREE.ExtrudeGeometry(boardShape, { depth: .014, bevelEnabled: false }));
  const boardPos = boardGeometry.attributes.position, boardUV = boardGeometry.attributes.uv;
  for (let i = 0; i < boardPos.count; i++) boardUV.setXY(i, (boardPos.getX(i) * 100 + 160) / 660, 1 - (385 - boardPos.getY(i) * 100) / 777);
  const board = new THREE.Mesh(boardGeometry, [frontMaterial, rosewood]);
  board.position.z = face; guitar.add(board);

  // Frets: round nickel wire exactly on the frets painted in the photograph.
  const frets = [175.4, 201.1, 225.1, 248.0, 269.1, 289.1, 307.9, 326.2, 342.8, 358.2, 373.1, 387.4, 399.9, 412.5, 423.9, 434.8, 445.1, 454.2, 463.9, 471.9];
  frets.forEach((y) => {
    const [left, right] = boardEdge(y);
    const wire = place(new THREE.CylinderGeometry(.0034, .0034, (right - left) / 100 - .004, 10), metal, (left + right) / 2, y, boardTop + .001);
    wire.rotation.z = Math.PI / 2;
  });
  place(new THREE.BoxGeometry(.215, .026, .015), bone, 156, nutY - 1, boardTop + .007);

  // Strings: nut to saddle, fanning out like a real neck; the bass three are
  // round-wound. Each also runs on to its tuner post and to the tailpiece.
  const saddleY = 590, tailY = 662;
  const nutX = (i: number) => 156 + (i - 2.5) * 3.15;
  const saddleX = (i: number) => 157.5 + (i - 2.5) * 5.3;
  const tailX = (i: number) => 158 + (i - 2.5) * 3.4;
  const radii = [.0039, .0035, .0031, .0027, .0024, .0022];
  const stripe = document.createElement('canvas'); stripe.width = 4; stripe.height = 8;
  const pen = stripe.getContext('2d')!;
  pen.fillStyle = '#fff'; pen.fillRect(0, 0, 4, 8); pen.fillStyle = '#555'; pen.fillRect(0, 5, 4, 3);
  const windings: THREE.Texture[] = [];
  const stringMaterial = (index: number, length: number) => {
    // Satin metal with a faint glow of its own: a fully metallic thin wire mirrors
    // the dark room and vanishes against the rosewood.
    if (index > 2) return new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: .7, roughness: .24, emissive: 0x5e636a, envMapIntensity: 1.4 });
    const bump = new THREE.CanvasTexture(stripe);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.set(1, length / .0042);
    windings.push(bump);
    return new THREE.MeshStandardMaterial({ color: 0xe0cc9c, metalness: .7, roughness: .3, emissive: 0x7d6a45, bumpMap: bump, bumpScale: .7, envMapIntensity: 1.3 });
  };
  const up = new THREE.Vector3(0, 1, 0);
  const segment = (a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, heightSegments = 1) => {
    const direction = b.clone().sub(a), length = direction.length();
    const mesh = new THREE.Mesh(own(new THREE.CylinderGeometry(radius, radius, length, 8, heightSegments, true)), material);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    guitar.add(mesh);
    return { mesh, length };
  };
  const point = (x: number, y: number, z: number) => { const p = at(x, y); return new THREE.Vector3(p.x, p.y, z); };
  const posts = [[141.4, 101], [141.4, 83.2], [141.4, 66.5], [168.3, 66.5], [168.3, 83.2], [168.3, 101]];
  const materials: THREE.Material[] = [];
  const shade = document.createElement('canvas'); shade.width = 16; shade.height = 1;
  const brush = shade.getContext('2d')!, falloff = brush.createLinearGradient(0, 0, 16, 0);
  falloff.addColorStop(0, 'rgba(0,0,0,0)'); falloff.addColorStop(.5, 'rgba(0,0,0,1)'); falloff.addColorStop(1, 'rgba(0,0,0,0)');
  brush.fillStyle = falloff; brush.fillRect(0, 0, 16, 1);
  const shadeTexture = new THREE.CanvasTexture(shade);
  const shadow = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadeTexture, transparent: true, opacity: .62, depthWrite: false });
  const shadowStrip = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
    const direction = b.clone().sub(a), length = direction.length();
    const strip = new THREE.Mesh(own(new THREE.PlaneGeometry(width, length)), shadow);
    strip.position.copy(a).add(b).multiplyScalar(.5);
    strip.rotation.z = Math.atan2(direction.y, direction.x) - Math.PI / 2;
    guitar.add(strip);
  };
  const strings: GuitarString[] = Array.from({ length: 6 }, (_, index) => {
    const nut = point(nutX(index), nutY, stringZ), saddle = point(saddleX(index), saddleY, stringZ);
    const material = stringMaterial(index, nut.distanceTo(saddle)); materials.push(material);
    const { mesh, length } = segment(nut, saddle, radii[index], material, 96);
    segment(point(posts[index][0], posts[index][1], stringZ + .004), nut, radii[index], material);
    segment(saddle, point(tailX(index), tailY, face + .016), radii[index], material);
    const t = (boardEndY - nutY) / (saddleY - nutY), boardEnd = (i: number) => THREE.MathUtils.lerp(nutX(i), saddleX(i), t);
    shadowStrip(point(nutX(index), nutY, boardTop + .0006), point(boardEnd(index), boardEndY, boardTop + .0006), radii[index] * 9);
    shadowStrip(point(boardEnd(index), boardEndY, face + .0006), point(saddleX(index), saddleY, face + .0006), radii[index] * 9);
    return { mesh, length, index };
  });

  // Tuners: chrome posts on the face, pearl buttons out at the sides.
  posts.forEach(([x, y]) => {
    const post = place(new THREE.CylinderGeometry(.017, .02, .05, 16), chrome, x, y, face + .025);
    post.rotation.x = Math.PI / 2;
    const side = x < 156 ? -1 : 1;
    const shaft = place(new THREE.CylinderGeometry(.009, .009, .09, 10), chrome, x + side * 20, y, 0);
    shaft.rotation.z = Math.PI / 2;
    place(new THREE.BoxGeometry(.075, .05, .02), pearl, x + side * 27.5, y, 0);
  });

  // Pickups: chrome surrounds, black inserts, one pole piece under each string.
  const pickup = (cx: number, cy: number, w: number, h: number) => {
    place(new RoundedBoxGeometry(w, h, .016, 3, .007), chrome, cx, cy, face + .008);
    place(new THREE.BoxGeometry(w * .82, h * .56, .004), blackPlastic, cx, cy, face + .0165);
    const t = (cy - nutY) / (saddleY - nutY);
    for (let i = 0; i < 6; i++) {
      const pole = place(new THREE.CylinderGeometry(.0085, .0085, .005, 14), chrome, THREE.MathUtils.lerp(nutX(i), saddleX(i), t), cy, face + .018);
      pole.rotation.x = Math.PI / 2;
    }
  };
  pickup(156.75, 504.75, .535, .185);
  pickup(159.75, 567, .475, .16);

  // Bridge: rosewood base with a chrome saddle bar the strings rest on.
  place(new THREE.BoxGeometry(.62, .05, .022), rosewood, 157, saddleY, face + .011);
  place(new THREE.BoxGeometry(.36, .012, .008), chrome, 157.5, saddleY, stringZ - .004);

  // Trapeze tailpiece: anchor bar and two tapering rods.
  place(new THREE.BoxGeometry(.34, .03, .012), chrome, tailX(2.5), tailY, face + .01);
  segment(point(143.5, tailY + 2, face + .008), point(150, 714, face + .006), .006, chrome);
  segment(point(174, tailY + 2, face + .008), point(166, 714, face + .006), .006, chrome);
  place(new THREE.BoxGeometry(.16, .022, .01), chrome, 158, 714, face + .006);

  return {
    group: guitar,
    strings,
    metal,
    dispose: () => {
      texture.dispose();sideTexture.dispose();rearTexture.dispose();backGeometry.dispose();bodyGeometry.dispose();faceGeometry.dispose();
      hardware.forEach(g=>g.dispose()); windings.forEach(t=>t.dispose()); shadeTexture.dispose();
      [sideMaterial,frontMaterial,backMaterial,metal,chrome,blackPlastic,bone,rosewood,pearl,shadow,...materials].forEach(m=>m.dispose());
    },
  };
}
