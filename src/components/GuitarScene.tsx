import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface GuitarMotion { progress: number; reduced: boolean; pulse: number }
const smooth = (a: number, b: number, v: number) => THREE.MathUtils.smoothstep(v, a, b);

export default function GuitarScene({ motion }: { motion: React.RefObject<GuitarMotion> }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { container.classList.add('no-webgl'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 60);
    camera.position.z = 12;
    const guitar = new THREE.Group();
    scene.add(guitar);
    scene.add(new THREE.HemisphereLight(0xfff3dc, 0x29121c, 2.5));
    const key = new THREE.DirectionalLight(0xffecd2, 3.5);
    key.position.set(-4, 5, 7); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 3);
    rim.position.set(4, 2, -5); scene.add(rim);

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
    const frontMaterial = new THREE.MeshBasicMaterial({ transparent: false });
    const front = new THREE.Mesh(faceGeometry, frontMaterial);
    front.position.z = .122; guitar.add(front);
    const texture = new THREE.TextureLoader().load('/guitar-atlas-restored.png', t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(),8);
      frontMaterial.map = t; frontMaterial.needsUpdate = true;
      container.classList.add('loaded');
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
    const backMaterial=new THREE.MeshBasicMaterial({map:rearTexture,side:THREE.BackSide});
    const back=new THREE.Mesh(backGeometry,backMaterial);
    back.position.z=-.123;guitar.add(back);
    const metal = new THREE.MeshStandardMaterial({ color: 0xc8c0aa, roughness: .24, metalness: .85 });
    const hardware: THREE.BufferGeometry[] = [];
    const box = (x:number,y:number,w:number,h:number,z:number,d:number,material:THREE.Material) => {
      const geometry = new THREE.BoxGeometry(w,h,d); hardware.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((x-160)/100,(385-y)/100,z); guitar.add(mesh);
    };
    // Thin physical strings and frets catch the light during the rotation.
    for(let i=0;i<6;i++) box(148+i*3.2,357,.0035,4.33,.138,.003,metal);
    for(let i=0;i<18;i++) box(157,165+i*14,.19,.006,.14,.006,metal);
    [72,94,113].forEach(y => { box(130,y,.065,.10,.01,.10,metal); box(181,y,.065,.10,.01,.10,metal); });
    const rearPlateMaterial = new THREE.MeshStandardMaterial({color:0x171410,roughness:.55});
    // The real rear has no invented electronics plate; keep the reference intact.
    let height = innerHeight;
    const resize = () => {
      height = container.clientHeight;
      camera.aspect = container.clientWidth / height; camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, height);
    };
    resize(); window.addEventListener('resize',resize);
    const target={x:0,y:0},pointer={x:0,y:0};
    const move=(event:PointerEvent)=>{target.x=event.clientX/innerWidth*2-1;target.y=event.clientY/innerHeight*2-1;};
    const leave=()=>{target.x=0;target.y=0;};
    window.addEventListener('pointermove',move);document.documentElement.addEventListener('pointerleave',leave);
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if(document.hidden) return;
      const {progress:p,reduced,pulse} = motion.current;
      const rise = THREE.MathUtils.clamp((p-.21)/.55,0,1);
      const dock = smooth(.745,.81,p);
      const turn = THREE.MathUtils.clamp((p-.22)/.485,0,1);
      const viewportHeight = 2*Math.tan(THREE.MathUtils.degToRad(17))*12;
      const base = Math.min(1,camera.aspect/.52)*1.82;
      guitar.visible = p>.205 || reduced;
      // Fixed-size model rises from entirely BELOW the viewport. No scale-in.
      guitar.scale.setScalar((reduced?.16:THREE.MathUtils.lerp(base,.16,dock))*pulse);
      pointer.x+=(target.x-pointer.x)*.045;pointer.y+=(target.y-pointer.y)*.045;
      const sway=reduced?0:1-dock;
      guitar.rotation.set(reduced?0:Math.sin(turn*Math.PI)*.10-pointer.y*.22*sway,reduced?0:turn*Math.PI*2+pointer.x*.34*sway,reduced?0:Math.sin(turn*Math.PI*2)*.055+pointer.x*.025*sway);
      const fromBelow=-(viewportHeight*.5+3.9*base);
      const beyondTop=viewportHeight*.5+3.9*base;
      const travelY=THREE.MathUtils.lerp(fromBelow,beyondTop,rise);
      guitar.position.y=reduced?viewportHeight*.335:THREE.MathUtils.lerp(travelY,viewportHeight*.335,dock);
      renderer.render(scene,camera);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame); window.removeEventListener('resize',resize);window.removeEventListener('pointermove',move);document.documentElement.removeEventListener('pointerleave',leave);
      renderer.dispose(); texture.dispose();sideTexture.dispose();rearTexture.dispose();backGeometry.dispose();bodyGeometry.dispose(); faceGeometry.dispose();
      hardware.forEach(g=>g.dispose()); [sideMaterial,frontMaterial,backMaterial,metal,rearPlateMaterial].forEach(m=>m.dispose());
      renderer.domElement.remove();
    };
  },[motion]);
  return <div className="guitar-canvas" ref={host}><span className="guitar-fallback" aria-hidden="true" /></div>;
}

