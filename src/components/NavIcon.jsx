// NavIcon — inline SVG icon set for the nav bars.
const NavIcon = ({ name }) => {
  const icons = {
    home: <path d="M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10" />,
    backlog: <path d="M4 6h16M4 12h16M4 18h7" />,
    recommend: <path d="M12 2l2.5 7H22l-6 4.5L18.5 21 12 16.5 5.5 21 8 13.5 2 9h7.5z" />,
    upcoming: <path d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    wishlist: <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />,
    sync: <path d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-3l2 2M20 15a8 8 0 01-14 3l-2-2" />,
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>
  );
};

export default NavIcon;
