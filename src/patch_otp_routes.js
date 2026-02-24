/**
 * patch_otp_routes.js — run on Render shell:
 *   node /tmp/patch_otp_routes.js
 */
import { readFileSync, writeFileSync } from 'fs';

// Find authRoutes file
import { execSync } from 'child_process';
const routesPath = execSync('find /opt/render/project/src/src/routes -name "auth*"').toString().trim();
console.log('Routes file:', routesPath);

let content = readFileSync(routesPath, 'utf8');

// Add sendOtp and verifyOtp to imports
content = content.replace(
  /import \{([^}]+)\} from ['"].*authController['"]/,
  (match, imports) => {
    if (imports.includes('sendOtp')) return match;
    const newImports = imports.trim() + ',\n  sendOtp,\n  verifyOtp';
    return match.replace(imports, newImports);
  }
);

// Add routes before module.exports or export default
const newRoutes = `
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
`;

if (!content.includes('/send-otp')) {
  // Insert before the last export
  const exportMatch = content.match(/(export default router|module\.exports)/);
  if (exportMatch) {
    content = content.replace(exportMatch[0], newRoutes + '\n' + exportMatch[0]);
  } else {
    content = content + newRoutes;
  }
}

writeFileSync(routesPath, content);
console.log('✅ authRoutes patched');
console.log('  sendOtp route:', content.includes('/send-otp'));
console.log('  verifyOtp route:', content.includes('/verify-otp'));
