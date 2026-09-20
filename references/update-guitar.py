from pathlib import Path
p=Path('src/components/GuitarScene.tsx');s=p.read_text(encoding='utf-8-sig')
s=s.replace("const sideMaterial = new THREE.MeshStandardMaterial({ color: 0x32150f, roughness: .32, metalness: .12 });",'''const loader = new THREE.TextureLoader();
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
    const sideBounds=[[18,356,389],[100,365,409],[244,394,437],[870,395,444],[930,345,438],[1000,323,432],[1300,306,430],[1600,302,425],[1860,326,424],[1920,339,424]];''')
s=s.replace("bodyGeometry.translate(0,0,-.10);",'''bodyGeometry.translate(0,0,-.10);
    const edgePos=bodyGeometry.attributes.position,edgeUV=bodyGeometry.attributes.uv;
    for(let i=0;i<edgePos.count;i++){
      const y=sourceY(385-edgePos.getY(i)*100,[[42,18],[144,244],[437,930],[725,1915]]);
      const depth=THREE.MathUtils.clamp((edgePos.getZ(i)+.1)/.2,0,1);
      const x=THREE.MathUtils.lerp(interpolate(sideBounds,y,1),interpolate(sideBounds,y,2),depth);
      edgeUV.setXY(i,x/793,1-y/1983);
    }''')
a=s.index('    // The rear is a material reconstruction')
b=s.index('    const metal =',a)
s=s[:a]+'''    // Rear UV projection uses the newly supplied archival rear photograph.
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
''' +s[b:]
s=s.replace("    box(160,626,.65,.42,-.139,.024,rearPlateMaterial);", "    // The real rear has no invented electronics plate; keep the reference intact.")
a=s.index('      const appear = smooth(');b=s.index('      renderer.render(scene,camera);',a)
s=s[:a]+'''      const enter = smooth(.205,.355,p);
      const dock = smooth(.68,.845,p);
      const turn = smooth(.23,.68,p);
      const viewportHeight = 2*Math.tan(THREE.MathUtils.degToRad(17))*12;
      const base = Math.min(1,camera.aspect/.52)*.76;
      guitar.visible = p>.205 || reduced;
      // Fixed-size model rises from entirely BELOW the viewport. No scale-in.
      guitar.scale.setScalar((reduced?.14:THREE.MathUtils.lerp(base,.14,dock))*pulse);
      guitar.rotation.set(reduced?0:Math.sin(turn*Math.PI)*.10,reduced?0:turn*Math.PI*2,reduced?0:Math.sin(turn*Math.PI*2)*.055);
      const entryY=-(viewportHeight*.5+3.6*base)*(1-enter);
      guitar.position.y=reduced?viewportHeight*.255:THREE.MathUtils.lerp(entryY,viewportHeight*.255,dock);
''' +s[b:]
s=s.replace('renderer.dispose(); texture.dispose(); bodyGeometry.dispose(); faceGeometry.dispose();', 'renderer.dispose(); texture.dispose();sideTexture.dispose();rearTexture.dispose();backGeometry.dispose();bodyGeometry.dispose(); faceGeometry.dispose();')
p.write_text(s,encoding='utf-8')
