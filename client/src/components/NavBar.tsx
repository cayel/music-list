import React from 'react';
import { AppBar, Toolbar, Typography, IconButton, Button, Box } from '@mui/material';
import { NavLink } from 'react-router-dom';
import MenuIcon from '@mui/icons-material/Menu';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';

interface Props { onToggleTheme: () => void; mode: 'light' | 'dark'; }

const linkStyle = ({ isActive }: { isActive: boolean }) => ({
  color: 'inherit',
  opacity: isActive ? 1 : 0.65,
  textDecoration: 'none',
  fontWeight: 600,
  padding: '6px 14px',
  borderRadius: 999,
  background: isActive ? 'rgba(0,0,0,0.08)' : 'transparent'
});

const NavBar: React.FC<Props> = ({ onToggleTheme, mode }) => {
  return (
    <AppBar position="sticky" color="transparent" elevation={0} sx={{ backdropFilter: 'blur(8px)', borderBottom: theme => `1px solid ${theme.palette.divider}` }}>
      <Toolbar sx={{ gap: 1 }}>
        <IconButton edge="start" sx={{ mr: 1 }}><MenuIcon /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 700, mr: 2 }}>Base Musicale</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <NavLink to="/albums" style={linkStyle}>Albums</NavLink>
          <NavLink to="/lists" style={linkStyle}>Listes classées</NavLink>
          <NavLink to="/smart-lists" style={linkStyle}>Listes intelligentes</NavLink>
          <NavLink to="/stats" style={linkStyle}>Stats</NavLink>
          <NavLink to="/admin" style={linkStyle}>Admin</NavLink>
        </Box>
        <Box sx={{ flexGrow:1 }} />
        <IconButton onClick={onToggleTheme} color="inherit" size="small" aria-label="Basculer thème">
          {mode === 'light' ? <Brightness4Icon /> : <Brightness7Icon />}
        </IconButton>
        <Button href="/" size="small" sx={{ ml:1 }} variant="outlined">Legacy</Button>
      </Toolbar>
    </AppBar>
  );
};
export default NavBar;
