type Point = [number, number];

export function createFumbleRenderer(ctx: CanvasRenderingContext2D) {
    const ink='#8ad9f0',light='#bbeafa',shade='#479ab8',dark='#173e53';
    const duration=5300;
    function rect(x:number,y:number,w:number,h:number,color:string){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),w,h);}
    function line(x1:number,y1:number,x2:number,y2:number,width:number,color:string){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='butt';ctx.lineJoin='miter';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
    function limb(a:Point,b:Point,c:Point,color:string){
      // Tapered muscles, elbow highlights and dark gloves.
      line(...a,...b,9,color);line(...b,...c,6,color);
      line(a[0]+2,a[1],b[0]+2,b[1],2,shade);
      line(a[0]-1,a[1]-1,b[0]-1,b[1]-1,3,color===ink?light:ink);
      line(b[0]-1,b[1],c[0]-1,c[1],2,color===ink?'#a3e3f4':ink);
      rect(b[0]-2,b[1]-2,4,4,color===ink?light:ink);
      rect(c[0]-3,c[1]-2,6,5,dark);rect(c[0]-2,c[1]-2,4,2,shade);
      rect(c[0]-2,c[1]-1,1,2,light);rect(c[0],c[1]-1,1,2,ink);rect(c[0]+2,c[1],1,2,ink);
    }
    function leg(a:Point,b:Point,c:Point,color:string){
      line(...a,...b,10,color);line(...b,...c,6,color);
      line(a[0]-2,a[1],b[0]-2,b[1],2,color===ink?light:ink);
      rect(b[0]-3,b[1]-2,6,5,color===ink?light:shade);
      line(b[0],b[1]+3,c[0],c[1],3,shade);
      rect(c[0]-3,c[1]-2,10,4,dark);rect(c[0]-2,c[1]-2,7,2,ink);
      rect(c[0]-1,c[1]-2,1,2,light);rect(c[0]+2,c[1]-2,1,2,light);
      rect(c[0]-2,c[1]+1,8,1,shade);rect(c[0]-2,c[1]+2,2,1,light);rect(c[0]+4,c[1]+2,2,1,light);
    }
    function football(x:number,y:number,angle:number,loose=false){ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.rotate(angle);rect(-7,-3,3,6,shade);rect(-4,-5,10,10,ink);rect(6,-3,3,6,shade);rect(-3,-4,7,1,light);rect(-3,3,8,1,shade);rect(-3,-1,8,2,dark);for(let i=-2;i<=3;i+=3)rect(i,-3,1,5,dark);if(loose)rect(-1,-5,4,1,light);ctx.restore();}
    function player(x:number,y:number,pose:string,phase:number){
      ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(1.65,1.65);
      const stride=Math.floor(phase*9)%4;
      if(pose==='trip')ctx.rotate(.38);if(pose==='fall'){const fall=Math.min(1,Math.max(0,(phase-2.65)/.43));ctx.rotate(.38+(Math.PI/2-.38)*fall);}
      const legs:[Point,Point,Point][]=[ [[-3,-27],[-15,-14],[-24,-6]], [[-3,-27],[-3,-13],[-12,0]], [[-3,-27],[11,-15],[20,-5]], [[-3,-27],[1,-13],[9,0]] ];
      const far=legs[(stride+2)%4],near=legs[stride];
      const backLeg:[Point,Point,Point]=pose==='fall'?[[-4,-27],[8,-9],[12,10]]:far;
      leg(...backLeg,shade);
      ctx.save();ctx.translate(0,-7);
      // Layered shoulder pads, tapered jersey, helmet shell and open face cage.
      if(pose==='fall')limb([-3,-40],[9,-43],[11,-53],shade);
      else limb([-3,-40],[-14,-33],pose==='run'?[-17,-42]:[-15,-31],shade);
      // Broad pads taper to the waist; layered cyan values suggest fabric and anatomy.
      rect(-10,-45,19,5,shade);rect(-17,-42,32,9,shade);
      rect(-15,-43,28,8,ink);rect(-17,-40,10,7,ink);
      rect(-12,-42,7,3,light);rect(5,-42,6,3,light);
      rect(-16,-39,4,5,'#68bed8');rect(-12,-38,6,3,'#a3e3f4');
      rect(10,-39,4,6,'#5badc7');rect(-7,-36,3,10,'#a0e0f2');
      rect(5,-35,3,8,'#70c3dc');
      rect(-10,-35,20,9,ink);rect(-8,-26,16,9,ink);
      rect(-10,-34,4,10,shade);rect(7,-34,3,9,shade);
      rect(-7,-25,3,7,shade);rect(-4,-20,10,2,shade);
      rect(-8,-18,17,8,shade);rect(-8,-18,17,2,dark);
      rect(-7,-15,7,5,ink);rect(2,-15,6,5,ink);
      rect(-7,-15,2,5,light);rect(7,-15,2,5,light);
      // Two small block numerals echo the reference jersey.
      for(const nx of [-4,3]){
        rect(nx,-36,5,2,light);rect(nx+3,-34,2,7,light);
        rect(nx,-32,4,2,light);rect(nx,-36,2,5,light);
      }
      rect(-3,-45,8,4,shade);rect(-1,-44,5,2,ink);
      // Fabric seams, pad edges, jersey collar and belt hardware.
      rect(-15,-38,7,1,shade);rect(-14,-36,6,1,light);
      rect(9,-38,5,1,dark);rect(10,-36,4,1,light);
      rect(-4,-42,2,3,dark);rect(-2,-40,5,1,dark);rect(3,-42,2,3,dark);
      rect(-9,-31,2,5,'#62aec8');rect(7,-29,1,5,'#b5eafa');
      rect(-5,-23,4,1,'#b5eafa');rect(2,-22,4,1,'#59a6c1');
      rect(-1,-18,3,2,light);rect(0,-18,1,1,dark);
      rect(-6,-17,1,2,light);rect(6,-17,1,2,light);
      rect(-4,-14,3,2,'#a3e3f4');rect(3,-14,3,2,'#6ab7d1');
      // Once grounded, lift just the head from the neck to look toward the ball.
      ctx.save();
      if(pose==='fall'){
        const look=Math.min(1,Math.max(0,(phase-3.48)/.42));
        const eased=look*look*(3-2*look);
        ctx.translate(0,-39);ctx.rotate(-1.3*eased);ctx.translate(0,39);
      }
      ctx.translate(0,-39);ctx.scale(.78,.82);ctx.translate(0,39);
      // Helmet with stepped silhouette, center stripe, ear hole and shaded face.
      rect(-8,-63,15,3,ink);rect(-12,-60,23,4,ink);
      rect(-14,-56,27,11,ink);rect(-12,-45,17,5,shade);
      rect(-8,-61,12,2,light);rect(-12,-57,4,8,light);
      rect(-8,-59,8,3,'#d1f3fc');rect(-12,-53,3,5,'#72c8e0');rect(-7,-45,8,3,'#38849d');
      rect(-3,-63,3,18,light);rect(-10,-48,5,5,shade);
      rect(-9,-47,2,3,dark);rect(5,-53,9,10,shade);
      rect(6,-52,8,3,dark);rect(10,-48,5,5,ink);
      rect(12,-50,2,2,light);rect(14,-47,2,2,light);rect(10,-44,4,1,dark);
      rect(8,-44,5,3,light);rect(4,-42,5,4,shade);
      // Shell vents, ear padding, eye, cheek and chin strap.
      rect(-8,-57,2,1,shade);rect(-5,-58,2,1,shade);
      rect(5,-57,3,1,shade);rect(-10,-49,5,5,dark);
      rect(-9,-48,3,3,ink);rect(-8,-47,1,1,shade);
      rect(9,-51,4,1,'#c4effa');rect(12,-50,1,1,dark);
      rect(11,-47,3,2,'#a6d9e9');rect(10,-44,3,1,shade);
      rect(4,-43,2,3,light);rect(6,-41,4,1,light);
      // Horizontal and vertical bars leave a visible face opening.
      rect(12,-53,7,2,light);rect(17,-51,2,12,ink);
      rect(10,-46,9,2,light);rect(9,-40,10,2,ink);
      rect(12,-44,2,6,shade);rect(4,-40,7,2,light);
      ctx.restore();
      if(pose==='run') {limb([7,-38],[13,-30],[22,-31],ink);football(22,-32,-.35);ctx.restore();leg(...near,ink);}
      else if(pose==='trip'){limb([7,-38],[21,-35],[29,-42],ink);ctx.restore();leg([-3,-27],[8,-14],[18,-14],ink);}
      else {limb([7,-38],[12,-43],[12,-54],ink);ctx.restore();leg([-3,-27],[10,-9],[14,10],ink);}
      ctx.restore();
    }
    function draw(ms:number){
      const t=(ms%duration)/1000;ctx.clearRect(0,0,580,275);ctx.imageSmoothingEnabled=false;ctx.save();ctx.translate(-10,30);ctx.scale(1.2,1.2);
      // Quiet pixel field: no busy stadium behind the empty state.
      rect(62,153,396,1,'#335362');
      for(let i=0;i<7;i++)rect(97+i*46,154,2,5,'#294655');
      let x,y,pose='run';
      if(t<2.35){x=133+t*58;y=150-(Math.floor(t*9)%2)*2;}
      else if(t<2.65){const q=(t-2.35)/.3;x=269+q*12;y=149;pose='trip';}
      else {const q=Math.min(1,(t-2.65)/.43);x=281+q*2;y=149-q*27;pose='fall';}
      const fade=t<.18?t/.18:t>4.85?Math.max(0,(5.3-t)/.45):1;
      ctx.globalAlpha=fade;
      if(pose==='run'){
        for(let i=0;i<3;i++){const z=((t*70+i*13)%36);rect(x-35-z,136+i*6,i===1?12:7,2,shade);}
      }
      player(x,y,pose,t);
      if(t>=2.35){
        const q=t-2.35;const bx=305+Math.min(q,1.85)*70;let by;
        if(q<.7)by=83-30*Math.sin(q/.7*Math.PI)+q*92;
        else if(q<1.25)by=148-18*Math.sin((q-.7)/.55*Math.PI);
        else if(q<1.65)by=148-7*Math.sin((q-1.25)/.4*Math.PI);
        else by=148;
        ctx.save();ctx.translate(bx,by);ctx.scale(1.65,1.65);football(0,0,Math.floor(q*9)*.6,true);ctx.restore();
        if(q<.27){rect(301,85,3,8,light);rect(315,94,7,3,light);rect(291,90,3,3,ink);}
      }
      if(t>3.08&&t<3.65){const q=(t-3.08)/.57;ctx.globalAlpha=fade*(1-q);for(let i=0;i<6;i++)rect(380-i*9-q*14,148-(i%3)*4-q*6,4,3,shade);}
      ctx.globalAlpha=1;ctx.restore();
    }

  return draw;
}
