import React from 'react';
import { Box, Drawer, Toolbar, List, ListItemButton, ListItemIcon, ListItemText, IconButton, Divider, Switch, Tooltip, Typography } from '@mui/material';
import AlbumIcon from '@mui/icons-material/Album';
import ListIcon from '@mui/icons-material/List';
import BarChartIcon from '@mui/icons-material/BarChart';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import MenuIcon from '@mui/icons-material/Menu';
import { NavLink, useLocation } from 'react-router-dom';

interface LayoutProps { children: React.ReactNode; mode: 'light'|'dark'; onToggleTheme: () => void; }

const drawerWidthExpanded = 220;
const drawerWidthCollapsed = 72;

const navItems: { label:string; to:string; icon: React.ReactNode }[] = [
  { label:'Albums', to:'/albums', icon:<AlbumIcon /> },
  { label:'Listes', to:'/lists', icon:<ListIcon /> },
  { label:'Stats', to:'/stats', icon:<BarChartIcon /> },
  { label:'Admin', to:'/admin', icon:<AdminPanelSettingsIcon /> }
];

const Layout: React.FC<LayoutProps> = ({ children, mode, onToggleTheme }) => {
  const [open, setOpen] = React.useState(true);
  const location = useLocation();
  const toggleDrawer = () => setOpen(o => !o);

  return (
    <Box sx={{ display:'flex', minHeight:'100vh', bgcolor:'background.default', color:'text.primary' }}>
      <Drawer variant="permanent" open
        sx={{ width: open? drawerWidthExpanded: drawerWidthCollapsed, flexShrink:0,
          '& .MuiDrawer-paper': { width: open? drawerWidthExpanded: drawerWidthCollapsed, transition:'width .25s', boxSizing:'border-box', borderRight:(theme)=>`1px solid ${theme.palette.divider}`, background:(theme)=> theme.palette.background.paper, display:'flex', flexDirection:'column' } }}>
        <Box sx={{ display:'flex', alignItems:'center', justifyContent: open? 'space-between':'center', px:1.5, py:1 }}>
          <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ opacity: open?1:0, transition:'opacity .25s' }}>Base musicale</Typography>
          <IconButton size="small" onClick={toggleDrawer}>
            {open ? <MenuOpenIcon /> : <MenuIcon />}
          </IconButton>
        </Box>
        <Divider />
        <List sx={{ flexGrow:1, py:1 }}>
          {navItems.map(item => {
            const active = location.pathname.startsWith(item.to);
            return (
              <ListItemButton key={item.to} component={NavLink} to={item.to}
                sx={{ my:0.3, mx:1, borderRadius:2, position:'relative', '&.active, &.Mui-selected': { bgcolor:'primary.main', color:'primary.contrastText', '& .MuiListItemIcon-root': { color:'inherit' } }, ...(active? { bgcolor:'primary.main', color:'primary.contrastText' }: {}) }}>
                <ListItemIcon sx={{ minWidth:42, color: active? 'inherit':'text.secondary' }}>{item.icon}</ListItemIcon>
                {open && <ListItemText primaryTypographyProps={{ fontSize:14, fontWeight:600 }} primary={item.label} />}
              </ListItemButton>
            );
          })}
        </List>
        <Divider />
        <Box sx={{ display:'flex', alignItems:'center', justifyContent: open? 'space-between':'center', px:1.5, py:1, gap:1 }}>
          {open && <Typography variant="caption" sx={{ fontWeight:600 }}>Thème</Typography>}
          <Tooltip title="Basculer thème"><IconButton size="small" onClick={onToggleTheme}>{mode==='light'? <Brightness4Icon /> : <Brightness7Icon />}</IconButton></Tooltip>
        </Box>
        <Box sx={{ textAlign:'center', pb:1, opacity:0.6, fontSize:10 }}>v1.0.0</Box>
      </Drawer>
      <Box component="main" sx={{ flexGrow:1, display:'flex', flexDirection:'column' }}>
        {/* top spacer for potential AppBar if needed */}
        <Box sx={{ flexGrow:1, px: { xs:2, md:4 }, pt: { xs:2, md:3 }, pb:4 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default Layout;
